---
name: agentic-physics
description: Prove physics and mathematics statements in Lean 4 with the Agentic Physics prover, through the `agentic-physics` CLI. Use when the user wants a machine-checked Lean 4 proof of a physics result, wants a physics claim formalized as a Lean theorem, wants Lean code checked against Mathlib, Physlib or QuantumInfo without a local Lean install, wants to search Physlib or Mathlib for a lemma, or wants to talk to the Agentic Physics agent.
allowed-tools: Bash(agentic-physics:*)
---

# Agentic Physics: Lean 4 proofs of physics through the CLI

`agentic-physics` is the command-line client of Agentic Physics (agentic-physics.com). Its prover searches Physlib and Mathlib, writes candidate proofs, and has the Lean 4 kernel check every one. It runs on Agentic Physics' servers: this machine needs no Lean. Every run and session also appears in the user's console at agentic-physics.com.

## First

Run `agentic-physics whoami`. Exit code 3 means not signed in: ask the user to run `agentic-physics login` in their own terminal (it opens a browser). Do not try to sign in yourself; if the user hands you a one-time code from the sign-in page, `agentic-physics login --code <code>` works from here.

## Long commands

`prove`, `chat`, and `status`/`answer` with `--wait` follow the server for up to 540 seconds. Always give these Bash calls `timeout: 600000`. The run id (or session id) is printed first, and the work lives on the server: if a command is cut off nothing is lost — continue with `agentic-physics status <run_id> --wait 540` (or `agentic-physics chat --session <id>`).

## Proving a statement

1. **Get a Lean statement whose body is `sorry`.**
   - From prose: `agentic-physics formalize "<the physics in words>" -o <name>.lean`. Show the user the theorem and the review, and get their confirmation that it says what they mean before proving it: the prover proves exactly the statement, not the intent. Exit 4 means Lean rejected the statement or the review found it unfaithful.
   - From Lean: write it to a file. Import lines are fine (`import Mathlib` is implied; Physlib and QuantumInfo are always there).
   - Optional: `agentic-physics check <name>.lean` — a good statement elaborates with only the `declaration uses 'sorry'` warning. `check` is also how to test any Lean you write against Mathlib/Physlib.
2. **Prove it:** `agentic-physics prove <name>.lean --description "<the physics in words>" --domain <domain>`. Always pass `--description`: the prover searches the libraries with it. Domains: general, classical_mechanics, waves, fluid_mechanics, thermodynamics, statistical_mechanics, electromagnetism, optics, quantum_mechanics, relativity.
3. **Read the exit code:**
   - **0 — PROVED.** The kernel accepted the proof printed. Save it with `agentic-physics proof <run_id> -o <file>.lean`.
   - **4 — not proved.** Report the reason as printed. If the output says the statement is **FALSE**, the kernel proved its negation: report a disproof (the statement is wrong as written), not a failure. `rejected` means Lean could not read the statement: fix the statement, not the proof.
   - **5 — still running.** `agentic-physics status <run_id> --wait 540`.
   - **6 — the run asks a question** (only with `--mode interactive`). Show the user the question and the options. Answer with `agentic-physics answer <run_id> accept`, `stop`, or `steer "<words>"` once they decide, or when they told you to decide.
   - **3** — not signed in (see above). **1** — an error; the message says which.
4. **After a failure, think before retrying.** A statement can be false as written, miss a hypothesis, or need a simpler lemma proved first. `--mode automated` runs the decomposing prover (subgoals, revisions, up to 16 minutes) for statements that need several steps.

## Talking to the agent

For a conversation — explain a problem, formalize it together, plan a proof — use a session. `agentic-physics chat "<message>"` prints `Session <id>`; go on with `agentic-physics chat --session <id> "<reply>"`. The agent formalizes, searches and starts proof runs itself; the reply reports each run with the kernel's verdict, read fresh from the prover. When the agent shows a formal statement and asks for confirmation, relay it to the user rather than confirming on their behalf. The user can watch the session live at the URL printed with its id.

## Rules

- Never say a statement is proved unless a command exited 0 and printed "PROVED — the Lean kernel accepted the proof". Not proved is not false; say FALSE only when the kernel proved the negation.
- Never edit a kernel-accepted proof and present it as verified: re-check any changed Lean with `agentic-physics check`.
- Quote statements and proofs exactly as printed.
- Account limits: 40 proof runs a day and 3 at once, 40 formalizations an hour, 300 chat messages a day, 600 checks an hour. Never start runs in a loop.
- `agentic-physics <command> --help` documents every option; `--json` gives machine-readable output.
