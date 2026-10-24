import { Api, duration } from "./api.js";
import { CliError, EXIT } from "./errors.js";
import type { PipelineStep, RunFrame, RunSummary } from "./types.js";

/** Statuses a run never leaves. `awaiting_decision` is not one: an answer moves the run on. */
export const TERMINAL = new Set(["solved", "failed", "rejected", "error", "timeout", "cancelled"]);

/** How often a run is asked about. AGENTIC_PHYSICS_POLL_MS exists for the tests. */
const pollMs = () => Number(process.env.AGENTIC_PHYSICS_POLL_MS) || 3_000;
/** A follow lasts minutes; one dropped poll (a restart, a proxy's hiccup) must not end it. */
const TOLERATED_FAILURES = 4;

export const RUN_ID = /^run_[0-9a-f]{8}$/;

export function checkRunId(runId: string | undefined): string {
  if (!runId) throw new CliError("Name the run: its id looks like run_1a2b3c4d.", EXIT.usage);
  if (!RUN_ID.test(runId)) throw new CliError(`${runId} is not a run id (they look like run_1a2b3c4d).`, EXIT.usage);
  return runId;
}

export const readFrame = (api: Api, runId: string) => api.json<RunFrame>(`/api/agentic/runs/${runId}/progress`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const GLYPH: Record<PipelineStep["state"], string> = {
  pending: "·",
  running: "…",
  done: "✓",
  warn: "!",
  failed: "✗",
  stopped: "■",
};

export const stepLine = (step: PipelineStep) =>
  `${step.depth ? "    " : "  "}${GLYPH[step.state] ?? "·"} ${step.label}${step.detail ? ` — ${step.detail}` : ""}`;

/**
 * Poll a run until it settles, pauses on a question, or `waitSeconds` pass,
 * telling `onLine` what changed: a step that moved, something the pipeline
 * did, a place in the queue. Returns the last frame read.
 */
export async function followRun(
  api: Api,
  runId: string,
  waitSeconds: number,
  onLine: (line: string) => void,
): Promise<RunFrame> {
  const deadline = Date.now() + waitSeconds * 1000;
  const stepStates = new Map<string, string>();
  const activity = new Set<string>();
  let queue: number | undefined;

  const report = (frame: RunFrame) => {
    const clock = `[${duration(frame.elapsedMs ?? 0).padStart(7)}]`;
    if (frame.queuePosition !== undefined && frame.queuePosition !== queue) {
      queue = frame.queuePosition;
      onLine(`${clock} waiting for the prover: ${queue === 0 ? "next in line" : `${queue} run(s) ahead`}`);
    }
    for (const step of frame.steps ?? []) {
      if (stepStates.get(step.id) === step.state) continue;
      stepStates.set(step.id, step.state);
      if (step.state !== "pending") onLine(`${clock} ${stepLine(step).trimStart()}`);
    }
    for (const line of frame.activity ?? []) {
      const key = `${line.at}|${line.text}`;
      if (activity.has(key)) continue;
      activity.add(key);
      onLine(`${clock}   ${line.text}`);
    }
  };

  let frame = await readFrame(api, runId);
  report(frame);
  let failures = 0;
  while (!TERMINAL.has(frame.status) && frame.status !== "awaiting_decision" && Date.now() < deadline) {
    await sleep(Math.max(0, Math.min(pollMs(), deadline - Date.now())));
    try {
      frame = await readFrame(api, runId);
      failures = 0;
    } catch (error) {
      if (error instanceof CliError && error.exitCode !== EXIT.failure) throw error;
      failures += 1;
      if (failures > TOLERATED_FAILURES) throw error;
      onLine(`  (could not read the run: ${(error as Error).message}; retrying)`);
      continue;
    }
    report(frame);
  }
  return frame;
}

export type Outcome = "proved" | "not_proved" | "question" | "running";

export const OUTCOME_EXIT: Record<Outcome, number> = {
  proved: EXIT.ok,
  not_proved: EXIT.negative,
  question: EXIT.question,
  running: EXIT.pending,
};

/**
 * What a frame comes to. "Proved" is said only on the pipeline's own
 * verdict — the record's `verified`, which is the kernel having accepted
 * the proof of the theorem asked for — never because a proof string exists.
 */
export async function settle(api: Api, runId: string, frame: RunFrame): Promise<{ outcome: Outcome; summary?: RunSummary }> {
  if (frame.status === "awaiting_decision") return { outcome: "question" };
  if (!TERMINAL.has(frame.status)) return { outcome: "running" };
  const summary = await api.json<RunSummary>(`/api/agentic/runs/${runId}`);
  const proof = summary.proof ?? frame.proof;
  const proved = frame.status === "solved" && summary.verified === true && Boolean(proof);
  return { outcome: proved ? "proved" : "not_proved", summary };
}

export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const VERDICT: Record<string, string> = {
  failed: "not proved",
  rejected: "not proved: the statement did not elaborate, so Lean never read the theorem as written",
  error: "not proved: the run failed with an error",
  timeout: "not proved within the run's time limit",
  cancelled: "stopped before it finished: nothing was decided about the theorem",
  solved: "not counted as proved: the record does not say the kernel verified it",
};

/** The run's report, for a terminal or an agent reading the output. */
export function runReport(runId: string, frame: RunFrame, outcome: Outcome, summary: RunSummary | undefined, url: string): string[] {
  // A settled run's own wall clock; a frame read later counts the time since it started, not how long it ran.
  const wall = TERMINAL.has(frame.status) && frame.stats?.wallTimeSeconds ? frame.stats.wallTimeSeconds * 1000 : undefined;
  const elapsed = duration(wall ?? frame.elapsedMs ?? 0);
  const lines: string[] = [];
  switch (outcome) {
    case "proved": {
      const stats = frame.stats
        ? `, ${plural(frame.stats.llmCalls, "model call")}, ${plural(frame.stats.leanCalls, "Lean call")}`
        : "";
      lines.push(`${runId}: PROVED — the Lean kernel accepted the proof (${elapsed}${stats}).`, "");
      lines.push("```lean", (summary?.proof ?? frame.proof ?? "").trimEnd(), "```", "");
      lines.push(`Save it: agentic-physics proof ${runId} -o ${runId}.lean`);
      return lines;
    }
    case "question": {
      const decision = frame.decision;
      lines.push(`${runId}: waiting for your answer (${elapsed} in).`, "");
      if (decision) {
        lines.push(decision.question.trim(), "");
        if (decision.facts?.length) lines.push("What the run established:", ...decision.facts.map((f) => `  - ${f}`), "");
        if (decision.assessment) lines.push(`Assessment: ${decision.assessment}`, "");
        if (decision.options?.length) {
          lines.push("Options:");
          for (const option of decision.options) {
            lines.push(`  ${option.id.padEnd(6)} ${option.label}${option.why ? ` — ${option.why}` : ""}`);
          }
          lines.push("");
        }
      }
      lines.push(
        "Answer with one of:",
        `  agentic-physics answer ${runId} accept`,
        `  agentic-physics answer ${runId} steer "<how the proof goes, or what to prove instead>"`,
        `  agentic-physics answer ${runId} stop`,
      );
      return lines;
    }
    case "running": {
      const current = [...(frame.steps ?? [])].reverse().find((s) => s.state === "running");
      lines.push(`${runId}: still running after ${elapsed}${current ? ` (now: ${current.label})` : ""}.`);
      if (frame.queuePosition !== undefined) lines.push(`Waiting for the prover: ${frame.queuePosition} run(s) ahead.`);
      lines.push(`Follow it again: agentic-physics status ${runId} --wait 540`, `Or in the browser: ${url}/runs`);
      return lines;
    }
    case "not_proved": {
      lines.push(`${runId}: ${VERDICT[frame.status] ?? `not proved (${frame.status})`} after ${elapsed}.`);
      const why = frame.error ?? summary?.error;
      if (why) lines.push(`Why: ${why}`);
      if (frame.narrative) lines.push(frame.narrative);
      if (frame.refutation) {
        lines.push(
          "",
          "The statement is FALSE: the Lean kernel accepted a proof of its negation.",
          "```lean",
          frame.refutation.theorem.trim(),
          "",
          frame.refutation.proof.trimEnd(),
          "```",
        );
      }
      if (frame.diagnosis?.failed_subgoals?.length) {
        lines.push("", "Diagnosis:");
        if (frame.diagnosis.revision_reason) lines.push(`  ${frame.diagnosis.revision_reason}`);
        for (const subgoal of frame.diagnosis.failed_subgoals) {
          lines.push(`  - ${subgoal.description_nl}: ${subgoal.description}${subgoal.suggested_fix ? ` (fix: ${subgoal.suggested_fix})` : ""}`);
        }
      }
      if (frame.steps?.length) lines.push("", "Steps:", ...frame.steps.map(stepLine));
      return lines;
    }
  }
}
