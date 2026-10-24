import { writeFile } from "node:fs/promises";

import { Api, duration } from "../api.js";
import { DOMAINS, domain, oneLine, positiveInt, printJson, seconds, str, type Command, type Io, type Parsed } from "../cli.js";
import { resolveAuth } from "../config.js";
import { CliError, EXIT, UsageError } from "../errors.js";
import { hasSorry, readSource, splitStatement, theoremName } from "../lean.js";
import { OUTCOME_EXIT, checkRunId, followRun, readFrame, runReport, settle } from "../runs.js";
import type { ProofRunRow, RunFrame, RunSummary } from "../types.js";

/** Under Claude Code's ten-minute ceiling for one shell command, with room to print. */
export const DEFAULT_WAIT = 540;

const WAIT_HELP = `--wait SECONDS    Follow the run this long, then return (default WAIT).
                    The run itself goes on regardless: 0 returns at once.`;

/** Follow (when asked), decide, report, save; the exit code is the outcome's. */
async function finish(api: Api, runId: string, values: Parsed["values"], io: Io, waitSeconds: number): Promise<number> {
  const quiet = Boolean(values.quiet) || Boolean(values.json);
  const frame: RunFrame =
    waitSeconds > 0
      ? await followRun(api, runId, waitSeconds, (line) => {
          if (!quiet) io.err(line);
        })
      : await readFrame(api, runId);
  const { outcome, summary } = await settle(api, runId, frame);

  const output = str(values.output);
  const proof = summary?.proof ?? frame.proof ?? undefined;
  if (output && outcome === "proved" && proof) await writeFile(output, proof.endsWith("\n") ? proof : `${proof}\n`);

  if (values.json) {
    printJson(io, {
      run_id: runId,
      outcome,
      status: frame.status,
      verified: summary?.verified ?? false,
      proof: outcome === "proved" ? proof : null,
      error: frame.error ?? summary?.error ?? null,
      refutation: frame.refutation ?? null,
      decision: frame.decision ?? null,
      elapsed_seconds: Math.round((frame.elapsedMs ?? 0) / 1000),
      steps: frame.steps,
    });
  } else {
    if (waitSeconds > 0 && !quiet) io.err("");
    for (const line of runReport(runId, frame, outcome, summary, api.url)) io.out(line);
    if (output && outcome === "proved") io.err(`\nProof written to ${output}.`);
  }
  return OUTCOME_EXIT[outcome];
}

export const prove: Command = {
  name: "prove",
  group: "Proving",
  summary: "Prove a Lean 4 theorem whose body is `sorry`",
  options: {
    theorem: { type: "string" },
    description: { type: "string", short: "d" },
    domain: { type: "string" },
    title: { type: "string" },
    mode: { type: "string" },
    wait: { type: "string" },
    output: { type: "string", short: "o" },
    quiet: { type: "boolean", short: "q" },
    json: { type: "boolean" },
  },
  usage: `Usage: agentic-physics prove FILE.lean [options]
       agentic-physics prove --theorem "theorem t (x : ℝ) : x + 0 = x := by sorry" [options]

Starts a proof run on the console's prover and follows it. The theorem's
body must be \`sorry\`: the prover replaces it. The run searches Physlib and
Mathlib, writes candidate proofs, and has the Lean 4 kernel check each one.
Nothing counts as proved unless the kernel accepts it; a run can also end
with the statement proved FALSE (the kernel accepted its negation).

A FILE may hold import lines and one theorem. Every run is elaborated under
the standing environment (the curated Mathlib base, Physlib, QuantumInfo),
so a file from a local project needs no change.

The run id is printed first. The run lives on the console, not in this
process: stop following (or lose the connection) and it goes on; pick it
up again with \`agentic-physics status RUN_ID --wait 540\`.

Options:
  --theorem TEXT      The theorem inline, instead of FILE.
  -d, --description TEXT
                      The physics in words: what the statement says, in a
                      physicist's terms. Strongly recommended — the prover
                      searches the libraries with it.
  --domain D          ${DOMAINS.join(", ")}
                      (default: general)
  --title T           A name for the run (default: the theorem's name).
  --mode M            interactive: when the prover needs an intermediate
                        lemma it pauses and asks you (see \`answer\`).
                      automated: the decomposing prover — a blueprint of
                        subgoals, retried and revised, up to 16 minutes.
                      Default: neither; needed lemmas are proved on their
                      own as sub-runs, nothing is asked.
  ${WAIT_HELP.replace("WAIT", String(DEFAULT_WAIT))}
  -o, --output F      Write the proof to F if the kernel accepts one.
  -q, --quiet         No progress lines on stderr.
  --json              Print the result as one JSON object.

Exit codes: 0 proved; 4 not proved (failed, disproved, rejected, timed out,
cancelled); 5 still running when the wait ran out; 6 waiting for your
answer; 3 not signed in; 1 any other failure.`,
  async run({ values, positionals }, io) {
    if (positionals.length > 1) throw new UsageError("Prove one file at a time.");
    const source = await readSource(positionals[0], str(values.theorem), io.stdin);
    const { theorem, imports } = splitStatement(source.text);
    if (!theorem) throw new UsageError(`${source.label} holds no theorem.`);
    if (!hasSorry(theorem)) {
      throw new UsageError("The theorem's body must be `sorry` (`... := by sorry`): the prover replaces it.");
    }
    const mode = str(values.mode);
    if (mode !== undefined && mode !== "interactive" && mode !== "automated") {
      throw new UsageError("--mode is interactive or automated.");
    }
    const description = str(values.description)?.trim() || undefined;
    const waitSeconds = seconds(values.wait, DEFAULT_WAIT);
    if (!description) {
      io.err("Note: no --description. The prover searches Physlib and Mathlib with the physics in words; without it, it starts from nothing.");
    }

    const api = new Api(resolveAuth(io.env));
    const { run_id: runId } = await api.json<{ run_id: string }>("/api/agentic/runs", {
      body: {
        lean_theorem: theorem,
        lean_imports: imports.length ? imports : undefined,
        description_nl: description,
        domain: domain(values.domain),
        title: str(values.title) ?? theoremName(theorem),
        mode,
      },
    });
    // First, and on its own: a caller that is cut off mid-follow still has the id.
    if (values.json) io.err(`Started ${runId}.`);
    else io.out(`Started ${runId}. It runs on the console: ${api.url}/runs`);
    return finish(api, runId, values, io, waitSeconds);
  },
};

export const status: Command = {
  name: "status",
  group: "Proving",
  summary: "Show a run, or follow it with --wait",
  options: {
    wait: { type: "string" },
    output: { type: "string", short: "o" },
    quiet: { type: "boolean", short: "q" },
    json: { type: "boolean" },
  },
  usage: `Usage: agentic-physics status RUN_ID [--wait SECONDS] [-o FILE] [--json]

Shows where a run is: proved (with the proof), not proved (with why),
waiting for your answer (with the question), or still running.

Options:
  ${WAIT_HELP.replace("WAIT", "0: just look")}
  -o, --output F      Write the proof to F if the kernel accepted one.
  -q, --quiet         No progress lines on stderr.
  --json              Print the result as one JSON object.

Exit codes as for \`prove\`: 0 proved, 4 not proved, 5 still running,
6 waiting for your answer.`,
  async run({ values, positionals }, io) {
    const runId = checkRunId(positionals[0]);
    const api = new Api(resolveAuth(io.env));
    return finish(api, runId, values, io, seconds(values.wait, 0));
  },
};

export const answer: Command = {
  name: "answer",
  group: "Proving",
  summary: "Answer a run waiting for you: accept, steer or stop",
  options: { wait: { type: "string" }, quiet: { type: "boolean", short: "q" }, json: { type: "boolean" } },
  usage: `Usage: agentic-physics answer RUN_ID accept
       agentic-physics answer RUN_ID steer "<how the proof goes, or what to prove instead>"
       agentic-physics answer RUN_ID stop

A run in interactive mode pauses when its prover wants an intermediate
lemma, and asks (\`status RUN_ID\` shows the question):
  accept   prove the lemma first, then go on with it;
  steer    go on with your words instead;
  stop     end the run here.

Options:
  --wait SECONDS   Follow the run after answering (default 0).
  -q, --quiet      No progress lines on stderr.
  --json           Print the result as JSON.`,
  async run({ values, positionals }, io) {
    const runId = checkRunId(positionals[0]);
    const choice = positionals[1];
    if (choice !== "accept" && choice !== "steer" && choice !== "stop") {
      throw new UsageError("Answer accept, steer \"<your words>\", or stop.");
    }
    const text = positionals.slice(2).join(" ").trim();
    if (choice === "steer" && !text) throw new UsageError('A steer needs your words: answer RUN_ID steer "<…>".');
    if (choice !== "steer" && text) throw new UsageError(`${choice} takes no words; did you mean steer?`);

    const api = new Api(resolveAuth(io.env));
    const frame = await readFrame(api, runId);
    if (frame.status !== "awaiting_decision") {
      throw new CliError(`${runId} is not waiting for an answer: it is ${frame.status}.`);
    }
    const answered = await api.json<{ status?: string; already?: boolean }>(`/api/agentic/runs/${runId}/answer`, {
      body: { choice, text: choice === "steer" ? text : undefined, question_id: frame.decision?.question_id ?? null },
    });
    const waitSeconds = seconds(values.wait, 0);
    if (waitSeconds === 0) {
      if (values.json) printJson(io, { run_id: runId, choice, ...answered });
      else {
        io.out(`${answered?.already ? "Already answered" : "Answered"}: ${choice}. ${choice === "stop" ? "The run ends here." : "The run goes on."}`);
        if (choice !== "stop") io.out(`Follow it: agentic-physics status ${runId} --wait ${DEFAULT_WAIT}`);
      }
      return EXIT.ok;
    }
    if (!values.json) io.out(`Answered: ${choice}.`);
    return finish(api, runId, values, io, waitSeconds);
  },
};

export const cancel: Command = {
  name: "cancel",
  group: "Proving",
  summary: "Stop a run",
  options: {},
  usage: `Usage: agentic-physics cancel RUN_ID

Stops a run on the console. Nothing is decided about the theorem.`,
  async run({ positionals }, io) {
    const runId = checkRunId(positionals[0]);
    await new Api(resolveAuth(io.env)).json(`/api/agentic/runs/${runId}/cancel`, { body: {} });
    io.out(`Stopped ${runId}.`);
    return EXIT.ok;
  },
};

export const proof: Command = {
  name: "proof",
  group: "Proving",
  summary: "Print or save a run's kernel-checked proof",
  options: { output: { type: "string", short: "o" } },
  usage: `Usage: agentic-physics proof RUN_ID [-o FILE]

Prints the Lean source the kernel accepted for this run, or writes it to
FILE. Exits 4 when the run has no accepted proof: nothing the kernel
rejected is ever handed out.`,
  async run({ values, positionals }, io) {
    const runId = checkRunId(positionals[0]);
    const summary = await new Api(resolveAuth(io.env)).json<RunSummary>(`/api/agentic/runs/${runId}`);
    if (!summary.verified || !summary.proof) {
      io.err(`${runId} has no kernel-accepted proof (status: ${summary.status}).`);
      return EXIT.negative;
    }
    const output = str(values.output);
    if (output) {
      await writeFile(output, summary.proof.endsWith("\n") ? summary.proof : `${summary.proof}\n`);
      io.err(`Written to ${output}.`);
    } else {
      io.out(summary.proof.trimEnd());
    }
    return EXIT.ok;
  },
};

export const runs: Command = {
  name: "runs",
  group: "Proving",
  summary: "List your recent runs",
  options: { limit: { type: "string", short: "n" }, json: { type: "boolean" } },
  usage: `Usage: agentic-physics runs [-n N] [--json]

Your runs, newest first, from every place you prove: the console, VS Code,
the desktop app and this CLI. The console's status is as of its last look
at a run; \`status RUN_ID\` asks the prover itself.

Options:
  -n, --limit N   How many (1–100, default 20).
  --json          Print them as JSON.`,
  async run({ values }, io) {
    const limit = positiveInt(values.limit, 20, "--limit", 100);
    const rows = await new Api(resolveAuth(io.env)).json<ProofRunRow[]>("/api/runs", { query: { limit } });
    if (values.json) {
      printJson(io, rows);
      return EXIT.ok;
    }
    if (!rows.length) {
      io.out("No runs yet.");
      return EXIT.ok;
    }
    for (const row of rows) {
      const when = new Date(row.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
      const took = row.wallTimeSeconds ? ` ${duration(row.wallTimeSeconds * 1000)}` : "";
      io.out(`${row.runId}  ${row.status.padEnd(9)} ${when}${took}  ${oneLine(row.title, 70)}`);
    }
    return EXIT.ok;
  },
};
