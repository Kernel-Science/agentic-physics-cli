import { writeFile } from "node:fs/promises";

import { Api } from "../api.js";
import { DOMAINS, domain, oneLine, positiveInt, printJson, str, type Command } from "../cli.js";
import { resolveAuth } from "../config.js";
import { EXIT, UsageError } from "../errors.js";
import { readSource } from "../lean.js";
import type { Formalized, LeanCheckResult, SearchResult } from "../types.js";

/** The text after the command: words on the line, or `-` (or a pipe) for standard input. */
async function prose(positionals: string[], io: Parameters<Command["run"]>[1], what: string): Promise<string> {
  const text =
    positionals.length === 1 && positionals[0] === "-"
      ? (await readSource("-", undefined, io.stdin)).text
      : positionals.length
        ? positionals.join(" ")
        : !io.stdin.isTTY
          ? (await readSource("-", undefined, io.stdin)).text
          : "";
  if (!text.trim()) throw new UsageError(`Give ${what} as an argument, or pipe it in.`);
  return text.trim();
}

export const formalize: Command = {
  name: "formalize",
  group: "Lean",
  summary: "Turn physics in words into a candidate Lean 4 theorem",
  options: {
    domain: { type: "string" },
    title: { type: "string" },
    output: { type: "string", short: "o" },
    json: { type: "boolean" },
  },
  usage: `Usage: agentic-physics formalize "<the physics, in words>" [options]
       agentic-physics formalize - < problem.md

Translates a physics statement (prose or LaTeX) into a Lean 4 theorem
whose body is \`sorry\`, checks that Lean accepts the statement, and reviews
whether it says what you asked. Proves nothing.

Read the statement before proving it: the prover proves exactly what the
theorem says, not what was meant.

Options:
  --domain D        ${DOMAINS.join(", ")}
                    (default: general)
  --title T         A short name for it.
  -o, --output F    Write the statement to F (imports and theorem), ready
                    for \`agentic-physics prove F\`.
  --json            Print the console's answer as JSON.

Exit codes: 0 a statement Lean accepts; 4 Lean rejected it, or the review
says it is not what was asked; 1 any other failure.`,
  async run({ values, positionals }, io) {
    const description = await prose(positionals, io, "the physics");
    const api = new Api(resolveAuth(io.env));
    const result = await api.json<Formalized>("/api/agentic/formalize", {
      body: { description, domain: domain(values.domain), title: str(values.title) },
      timeoutMs: 300_000,
    });
    const imports = (result.lean_imports ?? []).filter((line) => line.trim());
    const source = [...imports, ...(imports.length ? [""] : []), result.lean_theorem.trim(), ""].join("\n");
    const output = str(values.output);
    if (output) await writeFile(output, source);

    const rejected = result.elaborates === false || result.review?.verdict === "reject";
    if (values.json) {
      printJson(io, result);
      return rejected ? EXIT.negative : EXIT.ok;
    }

    if (result.title) io.out(result.title);
    io.out("");
    io.out("```lean");
    io.out(source.trimEnd());
    io.out("```");
    io.out("");
    io.out(
      result.elaborates === true
        ? "Lean accepts the statement."
        : result.elaborates === false
          ? "Lean REJECTS the statement:"
          : "Lean could not be asked about the statement: it is unchecked.",
    );
    for (const error of result.lean_errors ?? []) io.out(`  ${oneLine(error, 400)}`);
    const review = result.review;
    if (review) {
      const faithful = review.faithful ? `, ${review.faithful}` : "";
      io.out(`Review: ${review.verdict}${faithful}${review.faithful_note ? ` — ${review.faithful_note}` : ""}`);
      for (const finding of review.findings ?? []) io.out(`  - ${finding}`);
    }
    if (result.library_gap) io.out(`Library gap: ${result.library_gap}`);
    if (output) io.err(`\nWritten to ${output}.`);
    if (!rejected) {
      io.err(`\nIf it says what you mean, prove it:\n  agentic-physics prove ${output ?? "<file>.lean"} --description "<the physics in words>"`);
    }
    return rejected ? EXIT.negative : EXIT.ok;
  },
};

export const check: Command = {
  name: "check",
  group: "Lean",
  summary: "Check a Lean file against Mathlib, Physlib and QuantumInfo",
  options: { goals: { type: "boolean" }, json: { type: "boolean" } },
  usage: `Usage: agentic-physics check FILE.lean [--goals] [--json]
       agentic-physics check - < FILE.lean

Elaborates the file on the console's Lean server, under the same standing
environment proof runs use: the curated Mathlib base, Physlib and
QuantumInfo, at the versions the prover is pinned to. Your machine needs
no Lean installation. Import lines are not read (the environment is fixed).
Prints Lean's messages as FILE:LINE:COL: severity: text, and the goal at
each \`sorry\`.

Options:
  --goals    Also print the goal state before every tactic.
  --json     Print Lean's full answer as JSON.

Exit codes: 0 no errors (warnings, \`sorry\` included, are not errors);
4 Lean reported errors; 1 any other failure.`,
  async run({ values, positionals }, io) {
    if (positionals.length > 1) throw new UsageError("Check one file at a time.");
    const { text, label } = await readSource(positionals[0], undefined, io.stdin);
    if (!text.trim()) throw new UsageError(`${label} is empty.`);
    const api = new Api(resolveAuth(io.env));
    const result = await api.json<LeanCheckResult>("/api/workspace/check", { body: { code: text }, timeoutMs: 300_000 });
    const errors = result.messages.filter((m) => m.severity === "error").length;
    if (values.json) {
      printJson(io, result);
      return errors ? EXIT.negative : EXIT.ok;
    }

    const messages = [...result.messages].sort((a, b) => a.line - b.line || a.column - b.column);
    for (const m of messages) {
      const severity = m.severity === "information" ? "info" : m.severity;
      const [first, ...rest] = m.text.trimEnd().split("\n");
      io.out(`${label}:${m.line}:${m.column}: ${severity}: ${first}`);
      for (const line of rest) io.out(`  ${line}`);
    }
    for (const sorry of result.sorries ?? []) {
      io.out(`\nGoal at the sorry on line ${sorry.line}:`);
      io.out(sorry.goal.trimEnd().replace(/^/gm, "  "));
    }
    if (values.goals) {
      for (const tactic of result.tactics ?? []) {
        io.out(`\n${label}:${tactic.line}:${tactic.column}: ${oneLine(tactic.tactic, 120)}`);
        io.out(tactic.goals.trimEnd().replace(/^/gm, "  ") || "  (no goals)");
      }
    }
    const warnings = result.messages.filter((m) => m.severity === "warning").length;
    const parts = [errors ? `${errors} error${errors === 1 ? "" : "s"}` : "no errors"];
    if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
    const took =
      result.seconds === undefined
        ? ""
        : result.seconds < 1
          ? ` (${Math.round(result.seconds * 1000)} ms)`
          : ` (${result.seconds.toFixed(1)} s)`;
    io.out(`\n${label}: ${parts.join(", ")}${took}.`);
    return errors ? EXIT.negative : EXIT.ok;
  },
};

export const search: Command = {
  name: "search",
  group: "Lean",
  summary: "Search Physlib and Mathlib by meaning",
  options: { k: { type: "string", short: "k" }, json: { type: "boolean" } },
  usage: `Usage: agentic-physics search "<what you need, in words>" [-k N] [--json]

Searches Physlib and Mathlib together, by meaning rather than by name: ask
for "kinetic energy is nonnegative", not a declaration name. Each hit is a
declaration with its statement and where it lives.

Options:
  -k N      How many hits (1–50, default 10).
  --json    Print the hits as JSON.`,
  async run({ values, positionals }, io) {
    const query = await prose(positionals, io, "what to search for");
    const k = positiveInt(values.k, 10, "-k", 50);
    const api = new Api(resolveAuth(io.env));
    const results = await api.json<SearchResult[]>("/api/agentic/search", { query: { q: query, k } });
    if (values.json) {
      printJson(io, results);
      return EXIT.ok;
    }
    if (!results.length) {
      io.out("No hits.");
      return EXIT.ok;
    }
    results.forEach((hit, i) => {
      io.out(`${i + 1}. ${hit.name}  (${hit.source}, ${hit.relevance_score.toFixed(2)})`);
      io.out(`   ${oneLine(hit.statement, 400)}`);
      if (hit.docstring) io.out(`   ${oneLine(hit.docstring, 200)}`);
    });
    return EXIT.ok;
  },
};
