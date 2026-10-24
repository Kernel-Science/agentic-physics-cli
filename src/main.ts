import { parse, type Command, type Io } from "./cli.js";
import { login, logout, whoami } from "./commands/account.js";
import { chat, sessions } from "./commands/chat.js";
import { check, formalize, search } from "./commands/lean.js";
import { answer, cancel, proof, prove, runs, status } from "./commands/prove.js";
import { skill } from "./commands/skill.js";
import { DEFAULT_URL, consoleUrl } from "./config.js";
import { CliError, EXIT, UsageError, describe } from "./errors.js";
import { sanitize } from "./files.js";
import { VERSION } from "./version.js";

export const COMMANDS: Command[] = [
  login,
  logout,
  whoami,
  formalize,
  check,
  search,
  prove,
  status,
  answer,
  cancel,
  proof,
  runs,
  chat,
  sessions,
  skill,
];

export function overview(): string {
  const lines = [
    `agentic-physics ${VERSION} — Lean 4 proofs of physics, from Agentic Physics (agentic-physics.com)`,
    "",
    "Usage: agentic-physics <command> [options]",
  ];
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 3;
  for (const group of [...new Set(COMMANDS.map((c) => c.group))]) {
    lines.push("", group);
    for (const c of COMMANDS.filter((c) => c.group === group)) lines.push(`  ${c.name.padEnd(width)}${c.summary}`);
  }
  lines.push(
    "",
    "`agentic-physics <command> --help` describes a command and its options.",
    "Start with `agentic-physics login`. Docs: https://github.com/Kernel-Science/agentic-physics-cli",
  );
  return lines.join("\n");
}

/** Run one command line; never throws, always an exit code (see errors.ts EXIT). */
export async function main(argv: string[], raw: Io): Promise<number> {
  // Everything printed passes through sanitize: much of it is text the console relayed from others (files.ts).
  const io: Io = { ...raw, out: (text = "") => raw.out(sanitize(text)), err: (text = "") => raw.err(sanitize(text)) };
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    const command = name === "help" ? COMMANDS.find((c) => c.name === rest[0]) : undefined;
    io.out(command ? command.usage : overview());
    return EXIT.ok;
  }
  if (name === "--version" || name === "-v" || name === "version") {
    io.out(VERSION);
    return EXIT.ok;
  }
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) {
    io.err(`Unknown command: ${name}\n`);
    io.err(overview());
    return EXIT.usage;
  }
  try {
    const parsed = parse(rest, command.options);
    if (parsed.values.help) {
      io.out(command.usage);
      return EXIT.ok;
    }
    // A console other than agentic-physics.com is said out loud, every time: an AGENTIC_PHYSICS_URL a project set
    // for you is a console you did not choose.
    if (command.name !== "skill") {
      const url = consoleUrl(io.env);
      if (url !== DEFAULT_URL) io.err(`(console: ${url}, from AGENTIC_PHYSICS_URL)`);
    }
    return await command.run(parsed, io);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`agentic-physics ${name}: ${error.message}`);
      if (error instanceof UsageError) io.err(`See \`agentic-physics ${name} --help\`.`);
      return error.exitCode;
    }
    io.err(`agentic-physics ${name}: ${describe(error)}`);
    return EXIT.failure;
  }
}
