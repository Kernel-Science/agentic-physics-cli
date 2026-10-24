# agentic-physics

The command-line client for [Agentic Physics](https://agentic-physics.com). It turns physics into Lean 4, proves it, and gives back a proof the Lean kernel has checked. You can run it from a terminal, a script, or a coding agent such as Claude Code.

The prover, Lean, Mathlib and Physlib all run on Agentic Physics' servers. You need Node.js and an account, and nothing else: no Lean installation, no Mathlib build.

~~~console
$ agentic-physics formalize "The kinetic energy ½mv² of a body of non-negative mass m is non-negative, whatever its velocity v." -o ke.lean
Non-negativity of kinetic energy for non-negative mass

```lean
theorem kinetic_energy_nonneg (m v : ℝ) (hm : 0 ≤ m) : 0 ≤ (1 / 2 : ℝ) * m * v ^ 2 := by sorry
```

Lean accepts the statement.
Review: ok, faithful — …

$ agentic-physics prove ke.lean -d "The kinetic energy ½mv² of a body of non-negative mass is non-negative."
Started run_6c2700f8. It runs on the console: https://agentic-physics.com/runs
[     5s] ✓ Attempt 1 — a full proof — accepted by the kernel
[     8s] ✓ The kernel's verdict — accepted by the kernel · no axioms beyond the standard three

run_6c2700f8: PROVED — the Lean kernel accepted the proof (8s, 1 model call, 2 Lean calls).

```lean
import Mathlib.Algebra.Order.Star.Real

theorem kinetic_energy_nonneg (m v : ℝ) (hm : 0 ≤ m) : 0 ≤ (1 / 2 : ℝ) * m * v ^ 2 := by
  have h1 : 0 ≤ v ^ 2 := sq_nonneg v
  have h2 : 0 ≤ (1 / 2 : ℝ) * m := by linarith
  exact mul_nonneg h2 h1
```
~~~

- [Install](#install)
- [Sign in](#sign-in)
- [Prove something](#prove-something)
- [Talk to the agent](#talk-to-the-agent)
- [Use it from Claude Code](#use-it-from-claude-code) (or any coding agent)
- [Command reference](#command-reference)
- [Exit codes](#exit-codes)
- [Configuration](#configuration)
- [Limits](#limits)
- [What goes where](#what-goes-where)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Install

You need Node.js 20.10 or later (`node --version`).

```bash
npm install -g agentic-physics
```

You can also install it from a GitHub release, without npm's registry:

```bash
npm install -g https://github.com/Kernel-Science/agentic-physics-cli/releases/download/v0.1.0/agentic-physics-0.1.0.tgz
```

To try it without installing anything, use `npx agentic-physics --help`.

Check the install with:

```bash
agentic-physics --version
```

## Sign in

You need an account on [agentic-physics.com](https://agentic-physics.com). Then run:

```bash
agentic-physics login
```

1. The CLI opens `https://agentic-physics.com/connect/cli` in your browser.
2. Sign in there (or sign up). The page shows a one-time code.
3. Paste the code back into the terminal.

A code works once, and only for three minutes.

The session is stored in `~/.config/agentic-physics/credentials.json`, which only your user can read. It stays valid as long as you use it at least once a week. Afterwards:

```bash
agentic-physics whoami     # who and where you are signed in
agentic-physics logout     # revoke the session on the server and delete it here
```

**On a machine without a browser** (SSH, a container, or a coding agent's shell), open the printed page on any device where you are signed in. Then finish with:

```bash
agentic-physics login --code <the code the page shows>
```

**For CI and other unattended machines**, set `AGENTIC_PHYSICS_TOKEN` to a session token. That is the `token` field of `credentials.json` after a `login`. Like any session, it expires after a week without use. `logout` on the machine it came from revokes it.

## Prove something

### 1. Get a Lean statement

The prover proves a Lean 4 theorem whose body is `sorry`. If you have the physics in words, `formalize` writes the theorem for you:

```bash
agentic-physics formalize "A body's momentum p = m v is conserved when no net force acts on it" \
  --domain classical_mechanics -o momentum.lean
```

`formalize` checks that Lean accepts the statement. It also reviews whether the statement says what you asked: faithful, weaker, stronger, or different. **Read the statement before you prove it.** The prover proves exactly what the theorem says, not what was meant.

If you already have Lean, put it in a file. Import lines are fine; `import Mathlib` is implied.

```lean
import Mathlib

theorem ke_nonneg (m v : ℝ) (hm : 0 ≤ m) : 0 ≤ m * v ^ 2 / 2 := by
  sorry
```

`check` elaborates a file on the server, against the same Mathlib, Physlib and QuantumInfo the prover uses:

```console
$ agentic-physics check ke.lean
ke.lean:3:8: warning: declaration uses `sorry`

Goal at the sorry on line 4:
  m v : ℝ
  hm : 0 ≤ m
  ⊢ 0 ≤ m * v ^ 2 / 2

ke.lean: no errors, 1 warning (12 ms).
```

### 2. Prove it

```bash
agentic-physics prove ke.lean --description "Kinetic energy is non-negative for non-negative mass" --domain classical_mechanics
```

Always pass `--description`, the physics in words: the prover searches Physlib and Mathlib with it.

The run id is printed first, then the run's progress. By default the CLI follows the run for up to 9 minutes (`--wait SECONDS` changes that; `--wait 0` returns at once). The run itself lives on the server. If you stop following it, or lose your connection, it goes on, and you can pick it up again:

```bash
agentic-physics status run_6c2700f8 --wait 540
```

A run ends in one of these states:

| Result | What it means |
|---|---|
| **PROVED** | The Lean kernel accepted the proof, on no axioms beyond `propext`, `Classical.choice` and `Quot.sound`. The proof is printed. |
| **FALSE** | The kernel accepted a proof of the statement's *negation*. The statement is wrong as written. |
| not proved | No proof was found within the run's budget. That says nothing about whether the statement is true. |
| rejected | Lean could not read the statement. Fix the statement (`check` it), not the proof. |
| waiting for your answer | The run asks you a question. This happens only with `--mode interactive`; see below. |

To save a proof:

```bash
agentic-physics proof run_6c2700f8 -o ke_proof.lean
```

You can also add `-o FILE` to `prove` or `status`.

### Modes

```bash
agentic-physics prove thm.lean -d "…"                       # default
agentic-physics prove thm.lean -d "…" --mode interactive    # ask me before proving a lemma
agentic-physics prove thm.lean -d "…" --mode automated      # the decomposing prover
```

- **Default.** The prover writes whole proofs, with the kernel's feedback, while a tactic search races it. When the writer needs an intermediate lemma, it proves that lemma as a sub-run on its own.
- **`--mode interactive`.** Like the default, but before proving such a lemma the run pauses and asks you. `status` shows the question; answer it with one of:
  ```bash
  agentic-physics answer run_… accept                    # prove the lemma first, then go on
  agentic-physics answer run_… steer "use the work–energy theorem instead"
  agentic-physics answer run_… stop
  ```
- **`--mode automated`.** The decomposing prover: a blueprint of subgoals, proved one by one, revised when one fails, for up to 16 minutes. Use it for statements that need several steps.

Your runs, from every place you prove (the console, VS Code, the desktop app, this CLI):

```bash
agentic-physics runs
```

To stop a run:

```bash
agentic-physics cancel run_…
```

## Talk to the agent

The console's agent formalizes physics, searches the libraries, plans proofs, starts runs and explains what they found. `chat` talks to the same agent:

```console
$ agentic-physics chat "What does Physlib have about the kinetic energy of a free particle?"
Session 3d299659-5cfc-4bd5-86f7-f6da9a1f35d3  (https://agentic-physics.com/chat/3d299659-…)

[searchLibraries] 8 results

Physlib defines a kinetic energy for a free particle in its classical mechanics library, as
`ClassicalMechanics.FreeParticle.kineticEnergy`, …
```

A session is a console conversation. Open the printed link to watch it in your browser while the agent works.

To go on with the conversation, pass the session id back:

```bash
agentic-physics chat --session 3d299659-5cfc-4bd5-86f7-f6da9a1f35d3 "Prove that statement; I confirm it as written."
```

In the default interactive mode, the agent plans a proof before it proves anything. The reply shows the plan and the exact message to send to go ahead:

```text
[planProof] plan plan-zmxy1i (routine)
  1. Evaluate both sides in ℕ; they reduce to the same numeral, so rfl closes it.
  Prove with this plan:
    agentic-physics chat --session 3d29… "Go ahead — prove it with this plan (plan id: plan-zmxy1i)."
```

Each proof run in a reply is reported with the kernel's verdict, read fresh from the prover. Some useful forms:

- `agentic-physics chat --session ID`: wait for a reply that is still being written, and print the last one.
- `--history`: print the whole conversation first.
- `agentic-physics sessions`: list your sessions.
- `--mode automated` or `--mode planning`: start a session in that mode instead of interactive.

## Use it from Claude Code

The CLI is built to be driven by a coding agent. Its output is plain text an agent can read, its exit codes say what happened, and it never prompts unless a person is at the terminal.

```bash
npm install -g agentic-physics
agentic-physics login            # once, in your own terminal
cd ~/my-project
agentic-physics skill install    # writes .claude/skills/agentic-physics/SKILL.md
```

Then ask Claude Code for what you want. For example: *"Formalize and prove in Lean that the work done by a constant force along a straight path equals F·d."*

The skill teaches Claude Code the workflow:
- formalize, then confirm the statement with you;
- check, prove, and read the verdict;
- answer or relay a run's questions;
- never call something proved that the kernel did not accept.

The skill also allows Claude Code to run `agentic-physics` commands without asking each time.

Where to install the skill:
- `agentic-physics skill install --global` installs it for every project (`~/.claude/skills/`).
- Commit `.claude/skills/agentic-physics/` to share it with everyone working on a project.

`prove`, `chat` and `status --wait` follow the server for up to 9 minutes. Claude Code's shell commands time out after 2 minutes unless the agent asks for more, and the skill tells it to ask for 10. If a command is cut off anyway, nothing is lost: the run id is printed first, and the run goes on on the server.

**Other agents.** `agentic-physics skill show` prints the same instructions. Put them in any agent's system prompt or instructions file.

## Command reference

Every command takes `--help`, which documents it fully. Most take `--json` for machine-readable output.

| Command | What it does |
|---|---|
| `login [--code CODE] [--no-browser]` | Sign in through the browser. |
| `logout` | Revoke the stored session and delete it. |
| `whoami` | The account and console this machine is signed in to. |
| `formalize "<physics>" [--domain D] [--title T] [-o FILE]` | Prose or LaTeX to a candidate Lean theorem, reviewed for faithfulness. Proves nothing. |
| `check FILE [--goals]` | Elaborate a Lean file against Mathlib, Physlib and QuantumInfo. Prints messages as `FILE:LINE:COL`, plus the goal at each `sorry`. |
| `search "<need>" [-k N]` | Search Physlib and Mathlib by meaning. |
| `prove FILE \| --theorem TEXT [-d TEXT] [--domain D] [--mode M] [--wait S] [-o FILE]` | Start a proof run and follow it. |
| `status RUN [--wait S] [-o FILE]` | Where a run is; follow it with `--wait`. |
| `answer RUN accept\|stop` / `answer RUN steer "<words>"` | Answer a run that is waiting for you. |
| `cancel RUN` | Stop a run. |
| `proof RUN [-o FILE]` | The kernel-accepted proof of a run. |
| `runs [-n N]` | Your recent runs. |
| `chat "<message>" [--session ID] [--mode M] [--wait S]` | Talk to the agent. |
| `sessions [-n N]` | Your sessions. |
| `skill install [--global \| --dir DIR] [--force]` / `skill show` | The Claude Code skill. |

Domains (`--domain`): `general` (default), `classical_mechanics`, `waves`, `fluid_mechanics`, `thermodynamics`, `statistical_mechanics`, `electromagnetism`, `optics`, `quantum_mechanics`, `relativity`.

Commands that read text take it from:
- the command line (`formalize "…"`, `chat "…"`);
- a file (`check FILE`, `prove FILE`);
- standard input: pass `-`, or pipe it in.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. A proof is kernel-checked; a check found no errors; the agent replied. |
| 1 | Something failed: network, server, or input. The message says which. |
| 2 | The command line was wrong. |
| 3 | Not signed in, or the session expired. Run `agentic-physics login`. |
| 4 | A definite negative: the run ended without a proof (failed, FALSE, rejected, timed out, cancelled); Lean reported errors; or formalization was rejected. |
| 5 | Still running when the wait ran out. Nothing was decided; follow it again. |
| 6 | A run is waiting for your answer (`answer`). |

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `AGENTIC_PHYSICS_URL` | `https://agentic-physics.com` | The console to talk to. Must be `https://`, or `http://` to `localhost` only. |
| `AGENTIC_PHYSICS_TOKEN` | — | A session token to use instead of the stored login (CI, containers). |
| `AGENTIC_PHYSICS_CONFIG_DIR` | `$XDG_CONFIG_HOME/agentic-physics`, else `~/.config/agentic-physics` (`%APPDATA%\agentic-physics` on Windows) | Where the session is stored. |

## Limits

Each account has limits, the same however you reach Agentic Physics:

| | Limit |
|---|---|
| Proof runs | 40 a day, 3 at once |
| Formalizations | 40 an hour |
| Chat messages | 300 a day |
| Lean checks | 600 an hour |

A command that hits a limit says so, and says when to try again.

## What goes where

- The CLI talks only to `agentic-physics.com`, or to `AGENTIC_PHYSICS_URL` if you set it, over HTTPS.
- It refuses redirects rather than follow them, so your session never travels to an address you did not choose.
- A stored session is sent only to the console that issued it.
- What you send (statements, descriptions, messages) and what comes back (runs, proofs, conversations) is stored in your account, as if you had used the console in the browser. It appears in your history there.
- The CLI itself collects no telemetry.

## Troubleshooting

**`Not signed in` / `Your session expired` (exit 3).** Run `agentic-physics login`. A session lapses after a week without use, and `logout` ends it.

**`That code was not accepted`.** A code works once and for three minutes. Reload `…/connect/cli` for a new one.

**`You are signed in to X, not Y`.** `AGENTIC_PHYSICS_URL` points at a different console than the one you signed in to. Sign in there, or unset the variable.

**A run says `rejected`.** Lean could not elaborate the statement. `agentic-physics check FILE` shows Lean's errors.

**`still running` (exit 5).** The wait ran out; the run did not. `agentic-physics status RUN --wait 540`.

**`HTTP 502` / `524`.** The console or its prover did not answer in time. Try again in a minute. A run you started is not lost: `agentic-physics runs`.

**Anything else.** Open an issue at <https://github.com/Kernel-Science/agentic-physics-cli/issues>, with the command and its output (no token is ever printed).

## Development

```bash
git clone https://github.com/Kernel-Science/agentic-physics-cli.git
cd agentic-physics-cli
npm install        # also builds
npm test           # builds, then runs the unit tests and the end-to-end tests against a fake console
node dist/src/bin.js --help
```

The CLI has no runtime dependencies. It speaks the same HTTP API as the console's browser client, the VS Code extension and the desktop app. `AGENTIC_PHYSICS_URL=http://127.0.0.1:3000` points it at a local console.

To release:
1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Run `npm publish`.
3. Attach the `npm pack` tarball to a GitHub release tagged `v<version>`.

## License

MIT — see [LICENSE](LICENSE).
