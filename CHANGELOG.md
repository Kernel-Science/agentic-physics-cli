# Changelog

## 0.1.0 — 2026-10-24

First release.

- `login` (browser, or `--code`), `logout`, `whoami`; `AGENTIC_PHYSICS_TOKEN` for unattended machines.
- `formalize`, `check`, `search`.
- `prove` (with `--mode interactive|automated`), `status`, `answer`, `cancel`, `proof`, `runs`.
- `chat` and `sessions`: talk to the Agentic Physics agent in a console session.
- `skill install` / `skill show`: the Claude Code skill.
- Hardened before release (security review): `.lean`-only input and output, `-o` never overwrites or follows a link;
  server text stripped of terminal escapes and the agent's words quoted; `login` guards against a code for another
  account and against a console other than agentic-physics.com; `AGENTIC_PHYSICS_TOKEN` bound to its console; the
  skill auto-approves read-only commands only.
