/**
 * Loop Engine — máquina de estados do ciclo (puro, determinístico).
 *
 * Avança as fases discover→plan→split→execute→checkpoint→verify→budget→escalate,
 * respeitando: orçamento (estourou → aborta), report-only (efeito → aguarda aprovação),
 * rejeição humana (sem nova proposta → escala), verifier (reprovou → repete limitado por
 * attempts, senão escala) e handoff humano.
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
  /** Relógio (epoch ms); padrão `Date.now()`. O teto de tempo é medido contra `run.createdAt`. */
  readonly now?: number;
}

export interface AdvanceResult {
  readonly run: LoopRun;
  /** Descrição legível da transição, para o audit log (sempre não-sensível). */
  readonly note: string;
}

/**
 * Soma o consumo reportado pelo chamador e impõe o tempo decorrido desde `createdAt`:
 * o teto de tempo é AUTO-IMPOSTO pelo motor (não depende de o chamador passar wallClockMs),
 * mas nunca reduz o que o chamador já contabilizou.
 */
function applyUsage(next: LoopRun, input: AdvanceInput): void {
  next.usage = addUsage(next.usage, input.consumed ?? {});
  const elapsed = (input.now ?? Date.now()) - next.createdAt;
  if (Number.isFinite(elapsed) && elapsed > next.usage.wallClockMs) {
    next.usage.wallClockMs = elapsed;
  }
}

/** 1) Orçamento sempre primeiro: estourou → aborta e reporta. */
function applyBudget(next: LoopRun): AdvanceResult | null {
  const budget = checkBudget(next.budget, next.usage);
  if (budget.ok) return null;
  next.status = "aborted";
  return { run: next, note: `budget excedido: ${budget.exceeded.join(",")}` };
}

/**
 * 2) Rejeição humana: o run estava parado para aprovação, o operador rejeitou e não há nova
 * proposta → handoff humano (escalated). Sem isto o run voltaria a report_only e ciclaria
 * até estourar o budget, escondendo a decisão do operador.
 */
function applyRejection(next: LoopRun): AdvanceResult | null {
  if (next.status !== "awaiting_approval") return null;
  const rejected = next.steps.some((s) => s.status === "rejected");
  const proposed = next.steps.some((s) => s.status === "proposed");
  if (!rejected || proposed) return null;
  next.status = "escalated";
  return { run: next, note: "etapa rejeitada pelo operador e sem nova proposta: handoff humano" };
}

/** 3) Antes de propor efeito na fase execute, a política decide (fail-closed). */
function applyPolicyGate(next: LoopRun, policy: PolicyContext): AdvanceResult | null {
  if (next.phase !== "execute") return null;
  const step = next.steps.find((s) => s.status === "proposed");
  if (!step) return null;
  const decision = decideEffect(step.proposedEffect, policy);
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
  return null;
}

/**
 * 4) Verify: aplica o veredito do verifier. Reprovou → o MOTOR conta a tentativa aqui (o teto
 * é auto-imposto, não depende do chamador passar consumed.attempts) e repete limitado; se
 * estourou, escala para humano.
 */
function applyVerdict(next: LoopRun, verdict: LoopVerdict | undefined): AdvanceResult | null {
  if (next.phase !== "verify" || !verdict) return null;
  const step = next.steps.find((s) => s.id === verdict.stepId);
  if (step) step.status = verdict.approved ? "verified" : "failed";
  if (verdict.approved) return null;
  next.usage.attempts += 1;
  if (next.usage.attempts < next.budget.maxAttempts) {
    next.phase = "plan";
    next.status = "report_only";
    return { run: next, note: `verifier reprovou; repetindo (attempt ${next.usage.attempts})` };
  }
  next.status = "escalated";
  return { run: next, note: "verifier reprovou e sem tentativas: handoff humano" };
}

/** 5) Conclusão (todos verificados na fase verify) ou avança de fase mantendo report-only. */
function finishOrNext(next: LoopRun): AdvanceResult {
  const allVerified = next.steps.length > 0 && next.steps.every((s) => s.status === "verified");
  if (allVerified && next.phase === "verify") {
    next.status = "done";
    return { run: next, note: "todos os passos verificados: done" };
  }
  next.phase = nextPhase(next.phase);
  if (next.status === "awaiting_approval") next.status = "report_only";
  return { run: next, note: `-> ${next.phase}` };
}

/**
 * Executa UMA transição do ciclo. Fail-closed: qualquer efeito não auto-aprovado
 * pela política para o run em 'awaiting_approval'.
 */
export function advance(run: LoopRun, input: AdvanceInput): AdvanceResult {
  const next = clone(run);
  next.sequenceNumber += 1;
  applyUsage(next, input);
  return (
    applyBudget(next) ??
    applyRejection(next) ??
    applyPolicyGate(next, input.policy) ??
    applyVerdict(next, input.verdict) ??
    finishOrNext(next)
  );
}
