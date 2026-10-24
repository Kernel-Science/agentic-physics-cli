import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { UsageError } from "./errors.js";

export const DEFAULT_URL = "https://agentic-physics.com";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The console this CLI talks to, as an origin.
 *
 * https, or plain http to this machine only: the session token travels in
 * every request, and over http to another host anyone on the path could
 * read it.
 */
export function consoleUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.AGENTIC_PHYSICS_URL ?? "").trim() || DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`AGENTIC_PHYSICS_URL is not a URL: ${raw}`);
  }
  if (url.username || url.password) {
    throw new UsageError("AGENTIC_PHYSICS_URL must not carry a user name or password.");
  }
  const local = url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new UsageError(`AGENTIC_PHYSICS_URL must be https:// (http:// only for localhost), not ${raw}`);
  }
  return url.origin;
}

/** Where the session is kept: $XDG_CONFIG_HOME/agentic-physics, ~/.config/agentic-physics, or %APPDATA%\agentic-physics. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENTIC_PHYSICS_CONFIG_DIR) return env.AGENTIC_PHYSICS_CONFIG_DIR;
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "agentic-physics");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agentic-physics");
}

export interface Account {
  id: string;
  email: string;
  name: string;
}

/** A signed-in session, and the console it belongs to. The token is never sent anywhere else. */
export interface Credentials {
  url: string;
  token: string;
  account: Account;
  savedAt: string;
}

const credentialsPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "credentials.json");

export function readCredentials(env: NodeJS.ProcessEnv = process.env): Credentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(credentialsPath(env), "utf8"));
  } catch {
    return null;
  }
  const c = parsed as Partial<Credentials> | null;
  if (!c || typeof c.url !== "string" || typeof c.token !== "string" || !c.token || typeof c.account !== "object") {
    return null;
  }
  return c as Credentials;
}

/** Written owner-only (0600 in a 0700 directory), through a rename so a crash never leaves half a file. */
export function saveCredentials(credentials: Credentials, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = credentialsPath(env);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
  // the mode above is filtered by the umask on some systems; say it again
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return path;
}

export function clearCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  const path = credentialsPath(env);
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Which session a request goes out with, and from where. */
export interface Auth {
  url: string;
  token: string | null;
  source: "env" | "file" | null;
  account?: Account;
  /** Set when a stored session exists but belongs to another console. */
  storedFor?: string;
}

/**
 * AGENTIC_PHYSICS_TOKEN first (CI, containers, any machine without a
 * browser), then the stored session — but only when it was issued by the
 * console being addressed, so pointing AGENTIC_PHYSICS_URL elsewhere can
 * never send it to a different server.
 */
export function resolveAuth(env: NodeJS.ProcessEnv = process.env): Auth {
  const url = consoleUrl(env);
  const fromEnv = env.AGENTIC_PHYSICS_TOKEN?.trim();
  if (fromEnv) return { url, token: fromEnv, source: "env" };
  const saved = readCredentials(env);
  if (saved && saved.url === url) return { url, token: saved.token, source: "file", account: saved.account };
  return { url, token: null, source: null, storedFor: saved?.url };
}
