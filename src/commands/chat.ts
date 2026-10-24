import { randomUUID } from "node:crypto";

import { Api, duration } from "../api.js";
import { oneLine, positiveInt, printJson, seconds, str, type Command, type Io } from "../cli.js";
import { resolveAuth } from "../config.js";
import { CliError, EXIT, UsageError } from "../errors.js";
import { readSource } from "../lean.js";
import { DEFAULT_WAIT } from "./prove.js";
import { RUN_ID, readFrame, runReport, settle, type Outcome } from "../runs.js";
import type { ChatMessage, LiveTurn, MessagePart, RunFrame, Thread } from "../types.js";

const MODES = ["interactive", "automated", "planning"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pollMs = () => Number(process.env.AGENTIC_PHYSICS_POLL_MS) || 2_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const live = (api: Api, threadId: string) => api.json<LiveTurn>("/api/chat/live", { query: { threadId } });

/** The mode the conversation's last turn ran in, which the console's own composer keeps too. */
function threadMode(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const mode = messages[i].metadata?.mode;
    if (mode && MODES.includes(mode)) return mode;
  }
  return undefined;
}

const toolName = (part: MessagePart) => (part.type.startsWith("tool-") ? part.type.slice(5) : null);

interface ProveOutput extends Partial<RunFrame> {
  runId?: string;
}

/** One line for a tool the agent is using, as it moves. */
function toolProgress(name: string, part: MessagePart): string {
  if (part.state === "output-error") return `${name}: failed`;
  if (name === "proveTheorem") {
    const frame = (part.output ?? {}) as ProveOutput;
    return `proveTheorem${frame.runId ? ` ${frame.runId}` : ""}: ${frame.status ?? "starting"}`;
  }
  return `${name}: ${part.state === "output-available" ? "done" : "working"}`;
}

/**
 * Wait for the agent's turn in a conversation to end, or for the wait to
 * run out. The turn is the console's, not this process's: it goes on to
 * the end whether or not anyone is reading, and `/api/chat/live` is how a
 * reopened browser tab reads it too.
 */
async function waitForTurn(
  api: Api,
  threadId: string,
  afterMessageId: string | undefined,
  waitSeconds: number,
  onLine: (line: string) => void,
): Promise<{ turn: LiveTurn; replies: ChatMessage[]; done: boolean }> {
  const started = Date.now();
  const deadline = started + waitSeconds * 1000;
  const reported = new Map<string, string>();
  let lastWord = started;
  let sawLive = false;
  let failures = 0;
  for (;;) {
    let turn: LiveTurn;
    try {
      turn = await live(api, threadId);
      failures = 0;
    } catch (error) {
      if (error instanceof CliError && error.exitCode !== EXIT.failure) throw error;
      if ((failures += 1) > 4) throw error;
      await sleep(pollMs());
      continue;
    }
    sawLive ||= turn.live;
    const index = afterMessageId ? turn.messages.findIndex((m) => m.id === afterMessageId) : -1;
    const replies = index >= 0 ? turn.messages.slice(index + 1).filter((m) => m.role === "assistant") : [];

    for (const part of replies.flatMap((m) => m.parts)) {
      const name = toolName(part);
      if (!name) continue;
      const key = (part as { toolCallId?: string }).toolCallId ?? `${name}-${reported.size}`;
      const line = toolProgress(name, part);
      if (reported.get(key) !== line) {
        reported.set(key, line);
        onLine(`[${duration(Date.now() - started).padStart(7)}] ${line}`);
        lastWord = Date.now();
      }
    }
    if (Date.now() - lastWord > 60_000) {
      onLine(`[${duration(Date.now() - started).padStart(7)}] the agent is still working`);
      lastWord = Date.now();
    }

    // Ended: not live, and either our message is on record or the turn was seen to run. A turn that failed before
    // it saved anything leaves neither; give it a few seconds rather than waiting out the whole budget.
    if (!turn.live && (index >= 0 || sawLive || Date.now() - started > 15_000)) return { turn, replies, done: true };
    if (Date.now() >= deadline) return { turn, replies, done: false };
    await sleep(Math.min(pollMs(), Math.max(0, deadline - Date.now())));
  }
}

interface RunMention {
  runId: string;
  outcome: Outcome;
  frame: RunFrame;
}

/**
 * A reply as text: the agent's words verbatim, and each tool it used as a
 * short account. A proof run is read again from the prover, so what is
 * said about it is the run's state now, on the kernel's verdict, not the
 * frame the conversation stored when the agent stopped following it.
 */
async function renderReply(api: Api, threadId: string, message: ChatMessage, runs: RunMention[]): Promise<string[]> {
  const lines: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text?.trim()) {
      lines.push(...quote(part.text), "");
      continue;
    }
    const name = toolName(part);
    if (!name) continue;
    if (part.state === "output-error") {
      lines.push(`[${name}] failed: ${oneLine(part.errorText ?? "an error", 400)}`, "");
      continue;
    }
    const output = part.output as Record<string, unknown> | undefined;
    if (name === "proveTheorem") {
      // an id read from the conversation's record is checked like one typed on the command line before it is used
      const runId = (output as ProveOutput | undefined)?.runId;
      if (!runId || !RUN_ID.test(runId)) {
        lines.push(`[proveTheorem] ${(output as ProveOutput | undefined)?.error ?? "no run was started"}`, "");
        continue;
      }
      const frame = await readFrame(api, runId);
      const { outcome, summary } = await settle(api, runId, frame);
      runs.push({ runId, outcome, frame });
      lines.push(...runReport(runId, frame, outcome, summary, api.url), "");
      continue;
    }
    if (name === "formalizePhysics" && output?.ok) {
      const problem = output.problem as { title?: string; lean_theorem?: string; lean_imports?: string[] };
      const imports = (problem?.lean_imports ?? []).filter((l) => l.trim());
      lines.push(`[formalizePhysics] ${problem?.title ?? ""}`.trimEnd(), "```lean", ...imports, ...(imports.length ? [""] : []));
      lines.push((problem?.lean_theorem ?? "").trim(), "```");
      const elaborates = output.elaborates;
      lines.push(elaborates === true ? "Lean accepts the statement." : elaborates === false ? "Lean rejects the statement." : "Unchecked by Lean.", "");
      continue;
    }
    if (name === "planProof" && output?.ok) {
      // The console's card answers a plan with buttons; each sends a fixed message, which a
      // terminal sends as words.
      const planId = String(output.planId);
      const usable = /^plan-[A-Za-z0-9_-]{1,64}$/.test(planId);
      const plan = output.plan as { route?: string; steps?: { text: string }[]; first?: { statement: string; why: string }[]; difficulty?: string | null };
      lines.push(`[planProof] plan ${planId}${plan?.difficulty ? ` (${plan.difficulty})` : ""}`);
      if (plan?.route) lines.push(`  Route: ${oneLine(plan.route, 400)}`);
      (plan?.steps ?? []).forEach((step, i) => lines.push(`  ${i + 1}. ${oneLine(step.text, 300)}`));
      for (const first of plan?.first ?? []) lines.push(`  Prove first: ${oneLine(first.statement, 200)} — ${oneLine(first.why, 200)}`);
      // a command to copy only for an id that cannot break out of its quotes
      if (usable) {
        lines.push(
          "  Prove with this plan:",
          `    agentic-physics chat --session ${threadId} "Go ahead — prove it with this plan (plan id: ${planId})."`,
          "  Or steer it:",
          `    agentic-physics chat --session ${threadId} "Plan it again (previous plan id: ${planId}), following this: <your words>"`,
        );
      }
      lines.push("");
      continue;
    }
    if (part.state !== "output-available") {
      lines.push(`[${name}] did not finish`, "");
      continue;
    }
    const count = Array.isArray(output) ? output.length : Array.isArray(output?.results) ? (output.results as unknown[]).length : undefined;
    lines.push(`[${name}]${count !== undefined ? ` ${count} result${count === 1 ? "" : "s"}` : ""}`, "");
  }
  return lines;
}

/**
 * The agent's own words, each line behind a bar: what it says is quoted, never mistaken for a line this CLI wrote — a
 * reply that types "run_…: PROVED — the Lean kernel accepted the proof" is not a verdict.
 */
function quote(text: string): string[] {
  return text.trim().split("\n").map((line) => `│ ${line}`.trimEnd());
}

function messageText(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!.trim())
    .join("\n\n");
}

export const chat: Command = {
  name: "chat",
  group: "The agent",
  summary: "Talk to the Agentic Physics agent in a session",
  options: {
    session: { type: "string", short: "s" },
    mode: { type: "string" },
    wait: { type: "string" },
    history: { type: "boolean" },
    quiet: { type: "boolean", short: "q" },
    json: { type: "boolean" },
  },
  usage: `Usage: agentic-physics chat "<message>" [--session ID] [options]
       agentic-physics chat --session ID [--history]

Talks to the same agent as the console's chat: it formalizes physics into
Lean, searches Physlib and Mathlib, starts proof runs and explains what
they found. A session is a console conversation — open it in your browser
at <console>/chat/<ID> and watch it work.

With a message and no --session, a new session starts and its ID is
printed first; pass it back with --session to go on with the conversation.
With --session and no message, waits for the reply in progress (if any)
and prints the agent's last reply.

The agent's turn runs on the console. If the wait runs out it carries on;
read it later with \`agentic-physics chat --session ID\`.

Options:
  -s, --session ID   Go on with this session (a UUID, see \`sessions\`).
  --mode M           interactive (default for a new session): proof runs
                       pause to ask before proving a lemma they need.
                     automated: proof runs use the decomposing prover.
                     planning: the agent plans proofs and proves nothing.
                     Default for an existing session: the mode it is in.
  --wait SECONDS     Wait this long for the reply (default ${DEFAULT_WAIT}).
  --history          Print the whole conversation first.
  -q, --quiet        No progress lines on stderr.
  --json             Print the reply as JSON.

Exit codes: 0 the agent replied; 5 still working when the wait ran out;
6 a proof run in the reply is waiting for your answer (see \`answer\`);
3 not signed in; 1 any other failure.`,
  async run({ values, positionals }, io) {
    const session = str(values.session);
    if (session !== undefined && !UUID.test(session)) throw new UsageError("--session takes a session ID (a UUID): see `agentic-physics sessions`.");
    const mode = str(values.mode);
    if (mode !== undefined && !MODES.includes(mode)) throw new UsageError(`--mode is one of: ${MODES.join(", ")}.`);
    const waitSeconds = seconds(values.wait, DEFAULT_WAIT);
    const message =
      positionals.length === 1 && positionals[0] === "-"
        ? (await readSource("-", undefined, io.stdin)).text.trim()
        : positionals.join(" ").trim();
    if (!message && !session) throw new UsageError('Say something: agentic-physics chat "<message>".');

    const api = new Api(resolveAuth(io.env));
    const threadId = session ?? randomUUID();
    const before: LiveTurn = session ? await live(api, threadId) : { live: false, messages: [] };
    if (values.history && !values.json) {
      for (const m of before.messages) {
        const text = messageText(m);
        if (text) io.out(`${m.role === "user" ? "You" : "Agent"}:\n${quote(text).join("\n")}\n`);
      }
    }

    let afterMessageId: string | undefined;
    if (message) {
      if (before.live) {
        throw new CliError(
          `The agent is still answering in this session. Wait for it first: agentic-physics chat --session ${threadId}`,
          EXIT.pending,
        );
      }
      afterMessageId = randomUUID();
      const response = await api.raw("/api/chat", {
        body: {
          id: threadId,
          message: { id: afterMessageId, role: "user", parts: [{ type: "text", text: message }] },
          toolChoice: "auto",
          mode: mode ?? threadMode(before.messages) ?? "interactive",
        },
        timeoutMs: 60_000,
      });
      // The reply is read from the conversation's record, as a reopened browser tab reads it; the stream is not needed.
      await response.body?.cancel().catch(() => undefined);
      if (values.json) io.err(`Session ${threadId}`);
      else if (!session) io.out(`Session ${threadId}  (${api.url}/chat/${threadId})\n`);
    } else {
      afterMessageId = [...before.messages].reverse().find((m) => m.role === "user")?.id;
      if (!afterMessageId) {
        io.out("This session has no messages yet.");
        return EXIT.ok;
      }
    }

    const quiet = Boolean(values.quiet) || Boolean(values.json);
    const { replies, done } = await waitForTurn(api, threadId, afterMessageId, waitSeconds, (line) => {
      if (!quiet) io.err(line);
    });
    if (!quiet) io.err("");

    const runs: RunMention[] = [];
    const lines: string[] = [];
    for (const reply of replies) lines.push(...(await renderReply(api, threadId, reply, runs)));
    const waiting = runs.some((r) => r.outcome === "question");
    const exit = !done ? EXIT.pending : waiting ? EXIT.question : EXIT.ok;

    if (values.json) {
      printJson(io, {
        session: threadId,
        done,
        reply: replies.map(messageText).join("\n\n"),
        runs: runs.map((r) => ({ run_id: r.runId, outcome: r.outcome, status: r.frame.status })),
        messages: replies,
      });
      return exit;
    }
    if (!replies.length && done) lines.push("The agent's turn ended without a reply. Open the session in the browser to see why.");
    for (const line of lines) io.out(line);
    if (!done) {
      io.out(`The agent is still working (${duration(waitSeconds * 1000)} waited). Read the reply later:`);
      io.out(`  agentic-physics chat --session ${threadId}`);
    } else {
      io.err(`Go on: agentic-physics chat --session ${threadId} "<your reply>"`);
    }
    return exit;
  },
};

export const sessions: Command = {
  name: "sessions",
  group: "The agent",
  summary: "List your sessions (console conversations)",
  options: { limit: { type: "string", short: "n" }, json: { type: "boolean" } },
  usage: `Usage: agentic-physics sessions [-n N] [--json]

Your conversations with the agent, most recent first — the same list as
the console's sidebar, whichever surface they were started from.

Options:
  -n, --limit N   How many (1–200, default 20).
  --json          Print them as JSON.`,
  async run({ values }, io: Io) {
    const limit = positiveInt(values.limit, 20, "--limit", 200);
    const threads = await new Api(resolveAuth(io.env)).json<Thread[]>("/api/thread");
    const when = (t: Thread) => new Date(t.lastMessageAt ?? t.createdAt ?? 0).getTime();
    const recent = [...threads].sort((a, b) => when(b) - when(a)).slice(0, limit);
    if (values.json) {
      printJson(io, recent);
      return EXIT.ok;
    }
    if (!recent.length) {
      io.out("No sessions yet.");
      return EXIT.ok;
    }
    for (const t of recent) {
      const stamp = new Date(when(t)).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
      io.out(`${t.id}  ${stamp}  ${oneLine(t.title || "Untitled", 70)}`);
    }
    return EXIT.ok;
  },
};
