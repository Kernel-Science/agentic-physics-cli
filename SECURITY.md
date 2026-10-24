# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's
**[Report a vulnerability](https://github.com/Kernel-Science/agentic-physics-cli/security/advisories/new)**
form on this repository. The same channel covers the service the CLI talks to,
agentic-physics.com.

Include what you did, what happened, and what you expected. Never include a
session token or a sign-in code that is still valid.

Only the latest release is supported. Fixes ship as a new npm version, with a
GitHub security advisory.

## How the CLI handles your account

### Sign-in

- **The code.** A one-time code from `https://agentic-physics.com/connect/cli`
  is traded for a session. Anyone holding a code can sign in as you until it is
  used, for at most three minutes. Paste it only into a terminal on your own
  computer; Agentic Physics never asks you for one.
- **Switching accounts.** A code for a different account than the one already
  stored changes nothing unless you pass `--force`.
- **Other consoles.** `login` refuses to send a code to any console other than
  agentic-physics.com unless you confirm it with `--url`. A project can set
  `AGENTIC_PHYSICS_URL` for you, so any other console is named on every command.

### The session

- **Its own session.** Each `login` creates a session of its own, separate from
  your browser's and from your other machines'. `agentic-physics logout`
  revokes it on the server and touches nothing else. A session also lapses after
  a week without use.
- **Its reach.** An app's session can use the API that proving and chatting
  need: runs, conversations, checks and searches. It cannot change your email or
  password, list or end your other sessions, use the admin functions, or reach
  the console's pages.
- **Storage.** The session is stored in `credentials.json` in the CLI's config
  directory, written through an exclusively created temporary file. On macOS
  and Linux the file is readable by you only (mode 0600, in a 0700 directory).
  On Windows it sits in your per-user `%APPDATA%`. A config directory pointed
  into a git repository is refused.
- **Where it is sent.**
  - The stored session goes only to the console that issued it.
  - `AGENTIC_PHYSICS_TOKEN` goes only to agentic-physics.com, to `localhost`,
    or to the console `AGENTIC_PHYSICS_TOKEN_URL` names.
  - Connections are HTTPS, or plain HTTP to `localhost` only.
  - The CLI refuses redirects rather than follow them, never prints a token, and
    never passes one to the browser it opens.

## Running it from a coding agent

- **Files.** The CLI reads and writes `.lean` files only, so `check` cannot
  send another kind of file to the console. `-o` only ever creates a new file:
  it never overwrites one and never writes through a symbolic link.
  `skill install` refuses symbolic links on its path.
- **Text from the server.** Agent replies, Lean messages and library docstrings
  are printed without terminal escape sequences or bidirectional overrides. The
  agent's own words are quoted behind a `│` bar, so they cannot pass for the
  CLI's verdict.
- **The Claude Code skill.** It lets the agent run only the read-only commands
  without asking. It tells the agent to treat all output as data, never as
  instructions, and that only an exit code proves anything.

## Dependencies

The CLI has no runtime dependencies. CI runs with a read-only token and
actions pinned by commit. Releases after 0.1.0 are published from CI with npm
provenance.
