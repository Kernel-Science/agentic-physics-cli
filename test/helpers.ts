import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { main } from "../src/main.js";

export type Handler = (request: {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: any;
}) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | Promise<{ status?: number; json?: unknown; text?: string; headers?: Record<string, string> }>;

/** A console on 127.0.0.1 that answers with `handler`, recording every request. */
export async function fakeConsole(handler: Handler) {
  const requests: { method: string; path: string; headers: IncomingMessage["headers"]; body: any }[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let body: any = undefined;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const entry = { method: req.method ?? "GET", path: url.pathname, headers: req.headers, body };
    requests.push(entry);
    const answer = await handler({ ...entry, query: url.searchParams });
    res.statusCode = answer.status ?? 200;
    for (const [k, v] of Object.entries(answer.headers ?? {})) res.setHeader(k, v);
    if (answer.json !== undefined) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(answer.json));
    } else {
      res.end(answer.text ?? "");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const tempDir = () => mkdtempSync(join(tmpdir(), "agentic-physics-test-"));

/** Run the CLI in-process and capture what it printed. */
export async function cli(argv: string[], env: NodeJS.ProcessEnv, stdinText?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const stdin = Readable.from(stdinText === undefined ? [] : [stdinText]) as unknown as NodeJS.ReadableStream & { isTTY?: boolean };
  stdin.isTTY = stdinText === undefined;
  const code = await main(argv, {
    env,
    stdin,
    out: (text = "") => out.push(text),
    err: (text = "") => err.push(text),
    interactive: false,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
