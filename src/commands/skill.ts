import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { str, type Command } from "../cli.js";
import { CliError, EXIT, UsageError } from "../errors.js";

/** Shipped beside dist/ in the package: dist/src/commands/skill.js → ../../../skill/SKILL.md. */
const SKILL = new URL("../../../skill/SKILL.md", import.meta.url);

export const skill: Command = {
  name: "skill",
  group: "Claude Code",
  summary: "Install the Claude Code skill that teaches an agent this CLI",
  options: { global: { type: "boolean", short: "g" }, dir: { type: "string" }, force: { type: "boolean", short: "f" } },
  usage: `Usage: agentic-physics skill install [--global | --dir DIR] [--force]
       agentic-physics skill show

Claude Code learns to use this CLI from a skill: when to formalize, how to
read a run's verdict and its exit code, never to call something proved the
kernel did not accept. \`install\` writes it where Claude Code finds it:

  (default)    ./.claude/skills/agentic-physics/SKILL.md   this project
  --global     ~/.claude/skills/agentic-physics/SKILL.md   every project
  --dir DIR    DIR/agentic-physics/SKILL.md                any skills directory

\`show\` prints it, for any other agent's instructions.

Options:
  -f, --force   Replace a skill file that differs (an older version, or
                one you edited).`,
  async run({ values, positionals }, io) {
    const action = positionals[0];
    const text = await readFile(SKILL, "utf8");
    if (action === "show") {
      io.out(text.trimEnd());
      return EXIT.ok;
    }
    if (action !== "install") throw new UsageError("Say `skill install` or `skill show`.");

    const dir = str(values.dir);
    const base = dir ?? join(values.global ? homedir() : process.cwd(), ".claude");
    const skills = dir ?? join(base, "skills");
    const target = join(skills, "agentic-physics", "SKILL.md");
    // Run inside a cloned repository, any of these could be a link planted to send the write elsewhere (to
    // ~/.claude/settings.json, say), so none is followed. Your own ~/.claude may well be a link to your dotfiles.
    const project = !dir && !values.global;
    for (const path of [...(project ? [base, skills] : []), dirname(target), target]) {
      const stat = await lstat(path).catch(() => null);
      if (stat?.isSymbolicLink()) throw new CliError(`${path} is a symbolic link; the skill is not written through one.`);
    }
    const existing = await readFile(target, "utf8").catch(() => null);
    if (existing === text) {
      io.out(`The skill is already installed at ${target}.`);
      return EXIT.ok;
    }
    if (existing !== null && !values.force) {
      throw new CliError(`${target} exists and differs from this version's skill. --force replaces it.`);
    }
    await mkdir(dirname(target), { recursive: true });
    // a new file beside it, renamed over it: a rename replaces a name, it never writes through one
    const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, text, { flag: "wx" });
    await rename(temporary, target);
    io.out(`Installed the skill at ${target}.`);
    io.err(
      values.global || values.dir
        ? "Claude Code reads it in its next session."
        : "Claude Code reads it in its next session in this project. Commit it to share it with everyone who works here.",
    );
    return EXIT.ok;
  },
};
