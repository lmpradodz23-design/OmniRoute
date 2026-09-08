/**
 * Loop Engine — máquina de estados do ciclo (puro, determinístico).
 *
 * Avança as fases discover→plan→split→execute→checkpoint→verify→budget→escalate,
 * respeitando: orçamento (estourou → aborta), report-only (efeito → aguarda aprovação),
 * verifier (reprovou → repete limitado por attempts, senão escala) e handoff humano.
 *
 * NÃO executa efeitos. Retorna sempre um NOVO estado (não muta a entrada).
 */
import { addUsage, checkBudget } from "./budget.ts";
import { decideEffect, type PolicyContext } from "./policyGate.ts";
import { LOOP_PHASES, type LoopPhase, type LoopRun, type LoopVerdict } from "./types.ts";

function nextPhase(phase: LoopPhase): LoopPhase {
  const i = LOOP_PHASES.indexOf(phase);
  // após 'escalate' o ciclo recomeça em 'discover'
  return LOOP_PHASES[(i + 1) % LOOP_PHASES.length];
}

function clone(run: LoopRun): LoopRun {
  return {
    ...run,
    usage: { ...run.usage },
    steps: run.steps.map((s) => ({ ...s })),
  };
}

export interface AdvanceInput {
  /** Consumo desta iteração (tokens/tempo/tentativa) — contabilizado no orçamento. */
  readonly consumed?: { tokens?: number; wallClockMs?: number; attempts?: number };
  /** Veredito do verifier, quando a fase for 'verify'. */
  readonly verdict?: LoopVerdict;
  readonly policy: PolicyContext;
}

export interface AdvanceResult {
  readonly run: LoopRun;
  /** Descrição legível da transição, para o audit log (sempre não-sensível). */
  readonly note: string;
}

/**
 * Executa UMA transição do ciclo. Fail-closed: qualquer efeito não auto-aprovado
 * pela política para o run em 'awaiting_approval'.
 */
export function advance(run: LoopRun, input: AdvanceInput): AdvanceResult {
  const next = clone(run);
  next.sequenceNumber += 1;
  next.usage = addUsage(next.usage, input.consumed ?? {});

  // 1) Orçamento sempre primeiro: estourou → aborta e reporta.
  const budget = checkBudget(next.budget, next.usage);
  if (!budget.ok) {
    next.status = "aborted";
    return { run: next, note: `budget excedido: ${budget.exceeded.join(",")}` };
  }

  // 2) Antes de propor efeito na fase execute, a política decide.
  if (next.phase === "execute") {
    const step = next.steps.find((s) => s.status === "proposed");
    if (step) {
      const decision = decideEffect(step.proposedEffect, input.policy);
      if (decision.outcome === "deny") {
        step.status = "rejected";
        next.status = "failed";
        return { run: next, note: `efeito negado: ${decision.reason}` };
      }
      if (decision.outcome === "require_approval") {
        next.status = "awaiting_approval";
        return { run: next, note: `aguardando aprovação: ${decision.reason}` };
      }
      step.status = "approved";
    }
  }

  // 3) Verify: aplica o veredito do verifier.
  if (next.phase === "verify" && input.verdict) {
    const step = next.steps.find((s) => s.id === input.verdict!.stepId);
    if (step) step.status = input.verdict.approved ? "verified" : "failed";
    if (!input.verdict.approved) {
      // reprovou → o MOTOR conta a tentativa aqui (o teto é auto-imposto, não depende do
      // chamador passar consumed.attempts) e repete limitado; se estourou, escala para humano.
      next.usage.attempts += 1;
      const canRetry = next.usage.attempts < next.budget.maxAttempts;
      if (canRetry) {
        next.phase = "plan";
        next.status = "report_only";
        return { run: next, note: `verifier reprovou; repetindo (attempt ${next.usage.attempts})` };
      }
      next.status = "escalated";
      return { run: next, note: "verifier reprovou e sem tentativas: handoff humano" };
    }
  }

  // 4) Conclusão: todos os passos verificados e ciclo passou por verify.
  const allVerified = next.steps.length > 0 && next.steps.every((s) => s.status === "verified");
  if (allVerified && next.phase === "verify") {
    next.status = "done";
    return { run: next, note: "todos os passos verificados: done" };
  }

  // 5) Avança para a próxima fase, mantendo report-only por padrão.
  next.phase = nextPhase(next.phase);
  if (next.status === "awaiting_approval") next.status = "report_only";
  return { run: next, note: `-> ${next.phase}` };
}
