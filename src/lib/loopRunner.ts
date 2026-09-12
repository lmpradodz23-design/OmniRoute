/**
 * Loop Runner — orquestra o Loop Engine de ponta a ponta (report-only, persistente).
 *
 * Liga o núcleo puro (`open-sse/loop-engine`) ao repositório DB (`src/lib/db/loopEngine`):
 * inicia runs, avança um passo por vez (persistindo), para em `awaiting_approval` quando um
 * efeito externo é proposto, e retoma após aprovação humana explícita. NUNCA executa efeito
 * externo — o Policy Engine/aprovações do OmniRoute decidem; a execução real (quando aprovada)
 * fica com os conectores do OmniRoute, fora deste módulo.
 *
 * Toda mutação é leitura-modificação-escrita dentro de uma transação e grava com guarda
 * otimista por `sequenceNumber` (versão do run): um escritor desatualizado recebe
 * `LoopRunConflictError` e nada é gravado.
 */
import {
  advance,
  createLoopRun,
  decideEffect,
  proposeStep,
  type AdvanceInput,
  type LoopBudget,
  type LoopProposedEffect,
  type LoopRun,
} from "@omniroute/open-sse/loop-engine/index.ts";

import {
  DEFAULT_TENANT,
  getLoopRun,
  listLoopRuns,
  saveLoopRun,
  withLoopTransaction,
} from "./db/loopEngine";
import { loopStatusNeedsHuman, notifyLoopEvent } from "./buzzProducer";

/** Run ou etapa inexistente (neste tenant). */
export class LoopNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopNotFoundError";
  }
}

/** A operação não é válida no estado atual do run/etapa, ou a política a nega (409 na rota). */
export class LoopStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopStateError";
  }
}

function loadOrThrow(runId: string): LoopRun {
  const run = getLoopRun(runId);
  if (!run) throw new LoopNotFoundError(`loop run não encontrado: ${runId}`);
  return run;
}

/** Carrega, aplica `mutate`, incrementa a versão e grava com guarda otimista — tudo numa transação. */
function mutateRun(runId: string, mutate: (run: LoopRun) => void): LoopRun {
  return withLoopTransaction(() => {
    const run = loadOrThrow(runId);
    const expected = run.sequenceNumber;
    mutate(run);
    run.sequenceNumber = expected + 1;
    saveLoopRun(run, DEFAULT_TENANT, expected);
    return run;
  });
}

/** Inicia um run novo (report-only) e persiste. */
export function startRun(params: {
  pattern: string;
  budget?: Partial<LoopBudget>;
  correlationId?: string;
  taskId?: string;
}): LoopRun {
  const run = createLoopRun(params);
  saveLoopRun(run);
  return run;
}

/** Anexa uma etapa proposta a um run existente e persiste. */
export function addStep(
  runId: string,
  step: { title: string; proposedEffect?: LoopProposedEffect }
): LoopRun {
  return mutateRun(runId, (run) => {
    proposeStep(run, step);
  });
}

export interface AdvanceRunInput extends Partial<AdvanceInput> {
  /**
   * Versão (`sequenceNumber`) que o chamador viu ao decidir avançar. Se o run já mudou,
   * nada é gravado e `LoopRunConflictError` é lançado (409 na rota). Padrão: a versão atual.
   */
  readonly expectedSequenceNumber?: number;
}

/**
 * Avança UM passo do run e persiste. Report-only por padrão: um efeito não auto-aprovado
 * para o run em `awaiting_approval` (nada é executado). Retorna o novo estado + nota.
 */
export function advanceRun(runId: string, input?: AdvanceRunInput): { run: LoopRun; note: string } {
  return withLoopTransaction(() => {
    const current = loadOrThrow(runId);
    const expected = input?.expectedSequenceNumber ?? current.sequenceNumber;
    const result = advance(current, {
      consumed: input?.consumed,
      verdict: input?.verdict,
      policy: input?.policy ?? { reportOnly: true },
      now: input?.now,
    });
    saveLoopRun(result.run, DEFAULT_TENANT, expected);
    // Produtor Buzz: ao ENTRAR num estado que exige humano (aprovação/handoff), enfileira um aviso
    // durável no outbox. Só na TRANSIÇÃO (evita repetir a cada advance). Best-effort, report-only.
    if (loopStatusNeedsHuman(result.run.status) && result.run.status !== current.status) {
      notifyLoopEvent({
        runId: result.run.id,
        status: result.run.status,
        pattern: result.run.pattern,
        sequenceNumber: result.run.sequenceNumber,
      });
    }
    return result;
  });
}

function findStepOrThrow(run: LoopRun, stepId: string): LoopRun["steps"][number] {
  const step = run.steps.find((s) => s.id === stepId);
  if (!step) throw new LoopNotFoundError(`etapa não encontrada: ${stepId}`);
  return step;
}

/**
 * Aprova explicitamente uma etapa que estava aguardando aprovação, liberando o run para
 * prosseguir. Só um humano/operador chama isto (via painel/endpoint autenticado).
 *
 * Fail-closed: só aprova se o run está parado em `awaiting_approval` e a etapa ainda é
 * `proposed`; e o Policy Gate é reavaliado FORA de report-only — um efeito que ele nega
 * (`purchase`/`account_change`/`delete`) nunca vira `approved`, nem com aprovação humana.
 */
export function approveStep(runId: string, stepId: string): LoopRun {
  return mutateRun(runId, (run) => {
    const step = findStepOrThrow(run, stepId); // 404 só quando não existe; estado vem depois
    if (run.status !== "awaiting_approval") {
      throw new LoopStateError(
        `loop run ${runId} não está aguardando aprovação (status: ${run.status})`
      );
    }
    if (step.status !== "proposed") {
      throw new LoopStateError(`etapa ${stepId} não está proposta (status: ${step.status})`);
    }
    const decision = decideEffect(step.proposedEffect, { reportOnly: false });
    if (decision.outcome === "deny") {
      throw new LoopStateError(`aprovação recusada pela política: ${decision.reason}`);
    }
    step.status = "approved";
    run.status = "report_only"; // libera o run que estava parado para aprovação
  });
}

/**
 * Rejeita uma etapa (marca como rejeitada). O run permanece parado; no próximo advance o
 * motor escala para humano se não houver nova proposta (stateMachine.applyRejection).
 */
export function rejectStep(runId: string, stepId: string): LoopRun {
  return mutateRun(runId, (run) => {
    findStepOrThrow(run, stepId).status = "rejected";
  });
}

export { getLoopRun, listLoopRuns };
