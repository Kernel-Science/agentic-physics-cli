import { parseArgs } from "node:util";

import { UsageError } from "./errors.js";

export interface Io {
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  /** The result: what a script or an agent reads. */
  out(text?: string): void;
  /** Progress, hints and notes: never part of the result. */
  err(text?: string): void;
  /** A person at a terminal (stdin and stderr are TTYs), not a coding agent's subprocess. */
  interactive: boolean;
}

export type OptionSpec = Record<string, { type: "string" | "boolean"; short?: string }>;

export interface Parsed {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

export interface Command {
  name: string;
  group: string;
  summary: string;
  /** The whole `--help` text. */
  usage: string;
  options: OptionSpec;
  run(args: Parsed, io: Io): Promise<number>;
}

export function parse(args: string[], options: OptionSpec): Parsed {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ...options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Parsed["values"], positionals };
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A whole number of seconds from an option, within a day. */
export function seconds(value: unknown, fallback: number, name = "--wait"): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 86_400) throw new UsageError(`${name} takes whole seconds, 0 to 86400.`);
  return n;
}

export function positiveInt(value: unknown, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new UsageError(`${name} takes a whole number from 1 to ${max}.`);
  return n;
}

export const printJson = (io: Io, value: unknown) => io.out(JSON.stringify(value, null, 2));

export const DOMAINS = [
  "general",
  "classical_mechanics",
  "waves",
  "fluid_mechanics",
  "thermodynamics",
  "statistical_mechanics",
  "electromagnetism",
  "optics",
  "quantum_mechanics",
  "relativity",
];

export function domain(value: unknown): string {
  const given = str(value) ?? "general";
  if (!DOMAINS.includes(given)) throw new UsageError(`--domain is one of: ${DOMAINS.join(", ")}.`);
  return given;
}

/** Collapse whitespace and cut, for one-line listings. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
