/**
 * Loop Engine — controle de orçamento (puro).
 *
 * "Toda task tem budget (tokens, tempo, tentativas). Estourou → aborta e reporta."
 * Este módulo NUNCA executa efeito; apenas calcula se o run pode continuar.
 */
import type { LoopBudget, LoopBudgetUsage } from "./types.ts";

export function emptyUsage(): LoopBudgetUsage {
  return { tokens: 0, wallClockMs: 0, attempts: 0 };
}

/** Soma consumo ao uso acumulado, sem mutar o original. */
export function addUsage(
  current: LoopBudgetUsage,
  delta: Partial<LoopBudgetUsage>
): LoopBudgetUsage {
  return {
    tokens: current.tokens + Math.max(0, delta.tokens ?? 0),
    wallClockMs: current.wallClockMs + Math.max(0, delta.wallClockMs ?? 0),
    attempts: current.attempts + Math.max(0, delta.attempts ?? 0),
  };
}

export interface BudgetCheck {
  readonly ok: boolean;
  /** Qual limite estourou primeiro (para relatório honesto). */
  readonly exceeded: Array<"tokens" | "wallClockMs" | "attempts">;
}

/** true = ainda dentro do orçamento em TODAS as dimensões. */
export function checkBudget(budget: LoopBudget, usage: LoopBudgetUsage): BudgetCheck {
  const exceeded: BudgetCheck["exceeded"] = [];
  if (usage.tokens > budget.maxTokens) exceeded.push("tokens");
  if (usage.wallClockMs > budget.maxWallClockMs) exceeded.push("wallClockMs");
  if (usage.attempts > budget.maxAttempts) exceeded.push("attempts");
  return { ok: exceeded.length === 0, exceeded };
}
