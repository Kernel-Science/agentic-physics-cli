import type { Auth } from "./config.js";
import { CliError, EXIT, describe } from "./errors.js";
import { VERSION } from "./version.js";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send the session. Off only for the sign-in exchange itself. */
  auth?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The console's HTTP API, as the signed-in user.
 *
 * Every route here is the one the browser, the VS Code extension and the
 * desktop app already use; the console checks the session and that the run
 * or conversation is yours on every one of them. Redirects are refused
 * rather than followed, so the Authorization header can never be carried to
 * an address nobody chose.
 */
export class Api {
  constructor(readonly auth: Auth) {}

  get url(): string {
    return this.auth.url;
  }

  async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.raw(path, options);
    const text = await response.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new CliError(`${this.url}${path} did not answer with JSON.`);
    }
  }

  async text(path: string, options: RequestOptions = {}): Promise<string> {
    return (await this.raw(path, options)).text();
  }

  async raw(path: string, options: RequestOptions = {}): Promise<Response> {
    const sendSession = options.auth ?? true;
    if (sendSession && !this.auth.token) throw notSignedIn(this.auth);

    const url = new URL(path, this.auth.url);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: "application/json, text/plain;q=0.9, */*;q=0.1",
      // files the run under "from the command line" in the console's history
      "x-agentic-client": "cli",
      "user-agent": `agentic-physics-cli/${VERSION} node/${process.versions.node}`,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (sendSession) headers.authorization = `Bearer ${this.auth.token}`;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
        signal: timeout,
      });
    } catch (error) {
      if (timeout.aborted) {
        throw new CliError(`${this.url} did not answer within ${Math.round(timeoutMs / 1000)} s.`);
      }
      throw new CliError(`Could not reach ${this.url}: ${describe(error)}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const where = response.headers.get("location") ?? "another address";
      throw new CliError(
        `${this.url} redirected ${url.pathname} to ${where}. Set AGENTIC_PHYSICS_URL to the console's own address.`,
      );
    }
    if (!response.ok) throw await refusal(response, this.auth);
    return response;
  }
}

export function notSignedIn(auth: Auth): CliError {
  if (auth.storedFor) {
    return new CliError(
      `You are signed in to ${auth.storedFor}, not ${auth.url}. Run \`agentic-physics login\` to sign in there.`,
      EXIT.auth,
    );
  }
  return new CliError("Not signed in. Run `agentic-physics login` in a terminal first.", EXIT.auth);
}

/** What the console said, in a sentence: its own `error` when it gave one, never an HTML error page. */
async function refusal(response: Response, auth: Auth): Promise<CliError> {
  const text = await response.text().catch(() => "");
  let said = text;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    const message = body?.error ?? body?.message;
    if (message !== undefined) said = typeof message === "string" ? message : JSON.stringify(message);
  } catch {
    // not JSON: plain text, or a proxy's page
  }
  if (/^\s*<(!doctype|html)/i.test(said)) said = "";
  said = said.trim().slice(0, 800);

  switch (response.status) {
    case 401:
      return new CliError(
        auth.source === "env"
          ? "The console refused AGENTIC_PHYSICS_TOKEN: it expired or was signed out. Mint a new one with `agentic-physics login`."
          : "Your session expired or was signed out. Run `agentic-physics login` again.",
        EXIT.auth,
      );
    case 429: {
      const after = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? ` Try again in ${duration(after * 1000)}.` : "";
      return new CliError(`${said || "Too many requests."}${wait}`);
    }
    case 502:
    case 503:
    case 504:
    case 522:
    case 524:
      return new CliError(
        said
          ? `${said} (HTTP ${response.status})`
          : `The console or its prover did not answer (HTTP ${response.status}). Try again in a minute.`,
      );
    default:
      return new CliError(said ? `${said} (HTTP ${response.status})` : `The console answered HTTP ${response.status}.`);
  }
}

/** 75_000 → "1m 15s". */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
