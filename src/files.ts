import { writeFile } from "node:fs/promises";
import { extname } from "node:path";

import { CliError, UsageError } from "./errors.js";

/**
 * Lean in, Lean out.
 *
 * A coding agent may run this CLI on text it read somewhere, so a path is
 * never trusted to be harmless: the CLI reads only `.lean` files (so `check
 * ~/.aws/credentials` cannot send a secret to the console), and writes only
 * new `.lean` files — never over an existing file, never through a symlink
 * (so `-o ~/.bashrc` cannot plant a line in a shell's start-up).
 */
export function requireLean(path: string, what: string): void {
  if (extname(path).toLowerCase() !== ".lean") {
    throw new UsageError(`${what} must be a .lean file, not ${path}.`);
  }
}

/** Create `path` with `text`. Refuses an existing file or symlink (O_EXCL): the CLI never overwrites. */
export async function writeNewLeanFile(path: string, text: string): Promise<void> {
  requireLean(path, "-o");
  try {
    await writeFile(path, text.endsWith("\n") ? text : `${text}\n`, { flag: "wx", mode: 0o644 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new CliError(`${path} already exists. The CLI never overwrites a file: choose another name, or delete it first.`);
    }
    throw new CliError(`Cannot write ${path}: ${code ?? String(error)}`);
  }
}

/**
 * Text from the console, made safe to print: no terminal control sequences.
 *
 * Agent replies, Lean messages and library docstrings are text other parties
 * wrote. An escape sequence in them could rewrite the terminal's title or
 * clipboard (OSC 52), hide text from the person while an agent reading the
 * output still sees it, or forge colours. Kept: newline and tab. Removed: every
 * other C0 and C1 control, DEL, and the bidirectional overrides that can make
 * text read differently from what it is.
 */
export function sanitize(text: string): string {
  return (
    text
      // whole sequences first, so no inert remains are left behind: CSI (7- and 8-bit), OSC, and DCS/SOS/PM/APC
      .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
      .replace(/\u001b[PX^_][^\u001b]*(?:\u001b\\)?/g, "")
      // then any control left over, and the bidirectional overrides
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
  );
}
