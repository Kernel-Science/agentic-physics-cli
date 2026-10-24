import { readFile } from "node:fs/promises";

import { UsageError } from "./errors.js";

export interface Statement {
  /** The theorem as the prover takes it: everything but the import lines. */
  theorem: string;
  /** `import X` lines, as the run's `lean_imports`. */
  imports: string[];
}

/**
 * Split a Lean source into its imports and its theorem.
 *
 * Every run is elaborated under the console's standing environment — the
 * curated Mathlib base, Physlib and QuantumInfo — so a file written for a
 * local project needs no change. `import Mathlib` is dropped: the base
 * already holds what it would bring, and the prover refuses the blanket
 * import. Other imports are passed on.
 */
export function splitStatement(source: string): Statement {
  const imports: string[] = [];
  const rest: string[] = [];
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^\s*import\s+(.+?)\s*$/.exec(line);
    if (!match) {
      rest.push(line);
      continue;
    }
    for (const module of match[1].split(/\s+/)) {
      if (module !== "Mathlib" && !imports.includes(`import ${module}`)) imports.push(`import ${module}`);
    }
  }
  return { theorem: rest.join("\n").trim(), imports };
}

/** The declared name, for a run's title. */
export function theoremName(theorem: string): string | undefined {
  return /\b(?:theorem|lemma)\s+([^\s(:{[⦃]+)/.exec(theorem)?.[1];
}

export const hasSorry = (theorem: string): boolean => /\bsorry\b/.test(theorem);

/**
 * The text a command works on: inline text, a file, or standard input
 * (`-`, or nothing at all when input is piped in).
 */
export async function readSource(
  path: string | undefined,
  inline: string | undefined,
  stdin: NodeJS.ReadableStream & { isTTY?: boolean },
): Promise<{ text: string; label: string }> {
  if (inline !== undefined) return { text: inline, label: "<inline>" };
  if (path === "-" || (path === undefined && !stdin.isTTY)) {
    let text = "";
    for await (const chunk of stdin) text += chunk.toString();
    return { text, label: "<stdin>" };
  }
  if (path === undefined) throw new UsageError("Give a .lean file, `-` for standard input, or --theorem.");
  try {
    return { text: await readFile(path, "utf8"), label: path };
  } catch (error) {
    throw new UsageError(`Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
  }
}
