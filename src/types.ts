/**
 * The console's answers, as far as this CLI reads them. The console sends
 * more; nothing here depends on the rest.
 */

export type RunStatus =
  | "starting"
  | "running"
  | "solved"
  | "failed"
  | "rejected"
  | "error"
  | "timeout"
  | "cancelled"
  | "awaiting_decision";

export interface RunDecision {
  reason: string;
  question: string;
  facts?: string[];
  assessment?: string | null;
  options: { id: "accept" | "steer" | "stop"; label: string; why?: string | null }[];
  question_id?: string | null;
  elapsed_seconds?: number;
}

export interface PipelineStep {
  id: string;
  label: string;
  state: "pending" | "running" | "done" | "warn" | "failed" | "stopped";
  detail?: string;
  depth: 0 | 1;
}

/** `GET /api/agentic/runs/<id>/progress`: the run as the console's card draws it. */
export interface RunFrame {
  status: RunStatus;
  runId?: string;
  title?: string;
  mode?: string;
  queuePosition?: number;
  decision?: RunDecision;
  steps: PipelineStep[];
  proof?: string | null;
  refutation?: { theorem: string; proof: string };
  error?: string;
  narrative?: string;
  diagnosis?: {
    revision_reason: string | null;
    failed_subgoals: { description_nl: string; failure_type: string | null; description: string; suggested_fix: string }[];
  } | null;
  stats?: { wallTimeSeconds: number; iterations: number; llmCalls: number; leanCalls: number };
  activity?: { at: string; text: string }[];
  elapsedMs?: number;
}

/** `GET /api/agentic/runs/<id>`: the record, narrowed. `verified` is the pipeline's own word for "the kernel accepted it". */
export interface RunSummary {
  run_id: string;
  status: string;
  verified: boolean;
  proof?: string;
  error?: string;
}

export interface SearchResult {
  source: string;
  name: string;
  statement: string;
  docstring: string | null;
  file_path: string | null;
  relevance_score: number;
}

export interface LeanCheckResult {
  messages: { severity: string; line: number; column: number; end_line: number; end_column: number; text: string }[];
  tactics: { line: number; column: number; tactic: string; goals: string }[];
  sorries: { line: number; column: number; goal: string }[];
  seconds?: number;
}

export interface Formalized {
  title?: string;
  description_nl?: string;
  domain?: string;
  lean_theorem: string;
  lean_imports?: string[];
  elaborates?: boolean | null;
  lean_errors?: string[];
  library_gap?: string | null;
  review?: {
    verdict: "ok" | "warn" | "reject";
    faithful: string | null;
    faithful_note: string;
    findings: string[];
  } | null;
}

/** A row of `GET /api/runs`, the account's run history. */
export interface ProofRunRow {
  runId: string;
  title: string;
  status: string;
  domain: string;
  origin: string;
  createdAt: string;
  wallTimeSeconds?: number;
}

export interface Thread {
  id: string;
  title: string;
  createdAt?: string;
  lastMessageAt?: number | string;
}

export interface MessagePart {
  type: string;
  text?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  metadata?: { mode?: string } | null;
}

/** `GET /api/chat/live`: is the agent still answering, and the conversation so far. */
export interface LiveTurn {
  live: boolean;
  messages: ChatMessage[];
}
