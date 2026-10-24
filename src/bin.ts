#!/usr/bin/env node
import { main } from "./main.js";

// `agentic-physics runs | head` closes the pipe early; that is not an error worth a stack trace
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const write = (stream: NodeJS.WriteStream) => (text = "") => {
  stream.write(`${text}\n`);
};

main(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  out: write(process.stdout),
  err: write(process.stderr),
  interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`agentic-physics: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
