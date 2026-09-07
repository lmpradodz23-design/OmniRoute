/**
 * Loop Engine — tipos do núcleo (report-only).
 *
 * Deriva da metodologia Loop Engineering (github.com/cobusgreyling/loop-engineering,
 * MIT, SHA congelado 1d1af34b5d4b1af8bd5fc963ab2ff18499e706ff): um ciclo descobre
 * trabalho, planeja, divide em passos, executa por agentes, faz checkpoint, verifica
 * de forma independente, controla orçamento, repete de forma limitada e escala para
 * humano. Aqui o Loop apenas PROPÕE; o Policy Engine/aprovações do OmniRoute decidem.
 *
 * NENHUM efeito externo é executado por este módulo. Ver policyGate.ts.
 */

/** Fases canônicas do ciclo, na ordem. */
export const LOOP_PHASES = [
  "discover", // descobrir trabalho (issues, tarefas, sinais)
  "plan", // planejar a abordagem
  "split", // dividir em etapas pequenas
  "execute", // executar cada etapa (via agente) — PROPOSTA, não efeito
  "checkpoint", // persistir estado recuperável
  "verify", // verificação independente (verifier)
  "budget", // reavaliar orçamento (tokens/tempo/tentativas)
  "escalate", // escalar para humano (handoff)
] as const;

export type LoopPhase = (typeof LOOP_PHASES)[number];

/** Estado terminal ou de espera de um run. */
export type LoopRunStatus =
  | "report_only" // rodando em modo report-only (padrão inicial)
  | "awaiting_approval" // parou aguardando aprovação humana para um efeito
  | "verifying"
  | "done"
  | "failed"
  | "escalated" // handoff para humano
  | "aborted"; // budget estourado / cancelado

/** Orçamento de um run. Estourou → aborta e reporta (nunca ultrapassa). */
export interface LoopBudget {
  readonly maxTokens: number;
  readonly maxWallClockMs: number;
  readonly maxAttempts: number;
}

/** Consumo acumulado, comparado ao LoopBudget. */
export interface LoopBudgetUsage {
  tokens: number;
  wallClockMs: number;
  attempts: number;
}

/** Uma etapa proposta pelo ciclo. Report-only: nada é executado sem aprovação. */
export interface LoopStep {
  readonly id: string;
  readonly runId: string;
  readonly index: number;
  readonly title: string;
  /** Efeito externo que a etapa PROPÕE (ex.: abrir PR, enviar msg). Vazio = inócuo. */
  readonly proposedEffect?: LoopProposedEffect;
  status: "proposed" | "approved" | "rejected" | "verified" | "failed";
}

/** Efeito externo proposto — sempre passa pelo Policy Engine antes de qualquer execução. */
export interface LoopProposedEffect {
  /** Categoria do efeito (para a política decidir). */
  readonly kind:
    | "none"
    | "git_commit"
    | "git_pr"
    | "message_send"
    | "deploy"
    | "purchase"
    | "account_change"
    | "delete";
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
}

/** Veredito da verificação independente (verifier). */
export interface LoopVerdict {
  readonly stepId: string;
  readonly approved: boolean;
  readonly reason: string;
}

/** Um run do ciclo. Estado durável vive no DB do OmniRoute; este é o shape em memória. */
export interface LoopRun {
  readonly id: string;
  readonly pattern: string; // ex.: "daily-triage", "pr-babysitter"
  phase: LoopPhase;
  status: LoopRunStatus;
  readonly budget: LoopBudget;
  usage: LoopBudgetUsage;
  steps: LoopStep[];
  /** Idempotência / correlação para a ponte outbox-inbox. */
  readonly correlationId: string;
  readonly taskId?: string;
  sequenceNumber: number;
}

/** Decisão do Policy Engine para um efeito proposto. Código clássico decide, não a IA. */
export type PolicyDecision =
  | { readonly outcome: "allow" }
  | { readonly outcome: "deny"; readonly reason: string }
  | { readonly outcome: "require_approval"; readonly reason: string };
