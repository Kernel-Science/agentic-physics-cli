import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { Api } from "../api.js";
import { printJson, str, type Command, type Io } from "../cli.js";
import { clearCredentials, consoleUrl, readCredentials, resolveAuth, saveCredentials, type Account } from "../config.js";
import { CliError, EXIT, UsageError } from "../errors.js";

/** Best effort: a machine with no browser (a server, a container) just shows the link. */
function openBrowser(url: string, env: NodeJS.ProcessEnv): boolean {
  const platform = process.platform;
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function ask(question: string, io: Io): Promise<string> {
  const rl = createInterface({ input: io.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export const login: Command = {
  name: "login",
  group: "Account",
  summary: "Sign in through your browser",
  options: { code: { type: "string" }, "no-browser": { type: "boolean" } },
  usage: `Usage: agentic-physics login [--code CODE] [--no-browser]

Signs this machine in to your Agentic Physics account. The CLI opens
<console>/connect/cli in your browser; sign in there (or sign up), and the
page shows a one-time code. Paste it back here. The code works once and
for three minutes.

The session is stored in ~/.config/agentic-physics/credentials.json,
readable by you only, and stays valid as long as it is used at least once
a week. It never leaves this machine except to the console that issued it.

Options:
  --code CODE     Use a code you already have instead of being asked for
                  one. This is how to sign in where nothing can prompt
                  (a coding agent's shell, a script).
  --no-browser    Print the page's address instead of opening it.`,
  async run({ values }, io) {
    const url = consoleUrl(io.env);
    let code = str(values.code)?.trim();
    if (!code) {
      const page = `${url}/connect/cli`;
      io.err(`Sign in at:\n\n  ${page}\n`);
      if (!io.interactive) {
        io.err("This shell cannot prompt for the code. Open the page, then run:");
        io.err("  agentic-physics login --code <the code it shows>");
        return EXIT.auth;
      }
      if (!values["no-browser"] && openBrowser(page, io.env)) io.err("(opened in your browser)\n");
      code = await ask("Paste the code the page shows: ", io);
      if (!code) throw new UsageError("No code given.");
    }

    const api = new Api({ url, token: null, source: null });
    let result: { session?: { token?: string }; user?: Account } | null;
    try {
      result = await api.json("/api/auth/one-time-token/verify", { body: { token: code }, auth: false });
    } catch (error) {
      if (error instanceof CliError && /HTTP 4\d\d/.test(error.message)) {
        throw new CliError(
          "That code was not accepted. A code works once and for three minutes: open the page again for a new one.",
          EXIT.auth,
        );
      }
      throw error;
    }
    const token = result?.session?.token;
    const user = result?.user;
    if (!token || !user?.id) throw new CliError("The console did not return a session for that code.");

    const path = saveCredentials(
      { url, token, account: { id: user.id, email: user.email, name: user.name }, savedAt: new Date().toISOString() },
      io.env,
    );
    io.out(`Signed in to ${url} as ${user.name} <${user.email}>.`);
    io.err(`Session saved in ${path}.`);
    if (io.env.AGENTIC_PHYSICS_TOKEN) io.err("Note: AGENTIC_PHYSICS_TOKEN is set, and it is used instead of this session.");
    return EXIT.ok;
  },
};

export const logout: Command = {
  name: "logout",
  group: "Account",
  summary: "Sign out: revoke the stored session and forget it",
  options: {},
  usage: `Usage: agentic-physics logout

Revokes the stored session on the console, so the token stops working
everywhere, and deletes it from this machine.`,
  async run(_args, io) {
    const saved = readCredentials(io.env);
    if (!saved) {
      io.out("Not signed in: there is no stored session.");
    } else {
      let revoked = true;
      try {
        await new Api({ url: saved.url, token: saved.token, source: "file" }).json("/api/auth/sign-out", { body: {} });
      } catch {
        revoked = false;
      }
      clearCredentials(io.env);
      io.out(
        revoked
          ? `Signed out of ${saved.url}: the session was revoked and forgotten.`
          : `Forgot the session for ${saved.url}. The console could not be told, so the token stays valid until it expires (a week unused).`,
      );
    }
    if (io.env.AGENTIC_PHYSICS_TOKEN) io.err("AGENTIC_PHYSICS_TOKEN is still set in your environment; unset it too.");
    return EXIT.ok;
  },
};

export const whoami: Command = {
  name: "whoami",
  group: "Account",
  summary: "Show the account and console this machine is signed in to",
  options: { json: { type: "boolean" } },
  usage: `Usage: agentic-physics whoami [--json]

Asks the console who the current session belongs to. Exits 3 when not
signed in or when the session has expired.`,
  async run({ values }, io) {
    const auth = resolveAuth(io.env);
    const session = await new Api(auth).json<{ user?: Account; session?: { expiresAt?: string } } | null>(
      "/api/auth/get-session",
    );
    if (!session?.user) {
      throw new CliError("The console does not recognize this session. Run `agentic-physics login`.", EXIT.auth);
    }
    const source = auth.source === "env" ? "AGENTIC_PHYSICS_TOKEN" : "stored login";
    if (values.json) {
      printJson(io, { url: auth.url, user: session.user, expiresAt: session.session?.expiresAt ?? null, source });
      return EXIT.ok;
    }
    io.out(`${session.user.name} <${session.user.email}> on ${auth.url}`);
    const until = session.session?.expiresAt ? `; valid until ${new Date(session.session.expiresAt).toLocaleString()}` : "";
    io.err(`Session from the ${source}${until}.`);
    return EXIT.ok;
  },
};
