/**
 * Exit codes. A script or a coding agent branches on these, so each means one
 * thing and they never move.
 */
export const EXIT = {
  /** Done: the command did what it says; a proof is kernel-checked; a check found no errors. */
  ok: 0,
  /** Something went wrong: the network, the console, the input. The message says which. */
  failure: 1,
  /** The command line itself was wrong. */
  usage: 2,
  /** Not signed in, or the session expired: run `agentic-physics login`. */
  auth: 3,
  /** A definite negative: the run ended without a proof, or Lean reported errors. */
  negative: 4,
  /** Still going when the wait ran out: nothing was decided, follow it again. */
  pending: 5,
  /** A run is paused on a question only you can answer: `agentic-physics answer`. */
  question: 6,
} as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.failure,
  ) {
    super(message);
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.usage);
  }
}

export function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    // fetch's "fetch failed" says nothing; the cause names the refused connection or the DNS failure
    if (cause instanceof Error && cause.message) return `${error.message} (${cause.message})`;
    return error.message;
  }
  return String(error);
}
