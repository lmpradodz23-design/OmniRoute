/**
 * Loop Engine page — client-side view of the run/step shapes served by `/api/loop`.
 * Mirrors `open-sse/loop-engine/types.ts` (kept light: the page never imports the engine).
 */

export interface LoopStep {
  id: string;
  runId: string;
  index: number;
  title: string;
  proposedEffect?: { kind: string; summary: string };
  status: "proposed" | "approved" | "rejected" | "verified" | "failed";
}

export type LoopRunStatus =
  "report_only" | "awaiting_approval" | "verifying" | "done" | "failed" | "escalated" | "aborted";

export interface LoopRun {
  id: string;
  pattern: string;
  phase: string;
  status: LoopRunStatus;
  budget: { maxTokens: number; maxWallClockMs: number; maxAttempts: number };
  usage: { tokens: number; wallClockMs: number; attempts: number };
  steps: LoopStep[];
  correlationId: string;
  taskId?: string;
  sequenceNumber: number;
}

export type LoopDecision = "approve" | "reject";

/** A step decision waiting for the operator to confirm it in the ConfirmModal. */
export interface PendingDecision {
  runId: string;
  step: LoopStep;
  decision: LoopDecision;
}
