/**
 * Loop Engine — API pública do núcleo (report-only).
 *
 * Módulo LEVE do OmniRoute (não é serviço). O estado durável (runs/steps/checkpoints/
 * aprovações) vive no DB do OmniRoute (migração 175); este núcleo é a lógica pura de
 * ciclo, orçamento e política. Fica atrás da feature flag `loop_engine` (OFF por padrão).
 *
 * Configuração e controle ficam no PAINEL ÚNICO do OmniRoute (dashboard), não numa UI à parte.
 */
import { randomUUID } from "node:crypto";

import type { LoopBudget, LoopRun, LoopStep } from "./types.ts";

export * from "./types.ts";
export { addUsage, checkBudget, budgetPressure, emptyUsage } from "./budget.ts";
export { decideEffect, isAutoExecutable, type PolicyContext } from "./policyGate.ts";
export { advance, type AdvanceInput, type AdvanceResult } from "./stateMachine.ts";

export const DEFAULT_LOOP_BUDGET: LoopBudget = {
  maxTokens: 200_000,
  maxWallClockMs: 15 * 60_000, // 15 min
  maxAttempts: 3,
};

/** Cria um run novo em modo report-only, na primeira fase (discover). */
export function createLoopRun(params: {
  pattern: string;
  budget?: Partial<LoopBudget>;
  correlationId?: string;
  taskId?: string;
}): LoopRun {
  return {
    id: randomUUID(),
    pattern: params.pattern,
    phase: "discover",
    status: "report_only",
    budget: { ...DEFAULT_LOOP_BUDGET, ...params.budget },
    usage: { tokens: 0, wallClockMs: 0, attempts: 0 },
    steps: [],
    correlationId: params.correlationId ?? randomUUID(),
    taskId: params.taskId,
    sequenceNumber: 0,
  };
}

/** Anexa uma etapa proposta ao run (sem executar nada). */
export function proposeStep(
  run: LoopRun,
  step: Omit<LoopStep, "id" | "runId" | "index" | "status">
): LoopStep {
  const created: LoopStep = {
    id: randomUUID(),
    runId: run.id,
    index: run.steps.length,
    status: "proposed",
    ...step,
  };
  run.steps.push(created);
  return created;
}
