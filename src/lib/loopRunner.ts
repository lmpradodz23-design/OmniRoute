/**
 * Loop Runner — orquestra o Loop Engine de ponta a ponta (report-only, persistente).
 *
 * Liga o núcleo puro (`open-sse/loop-engine`) ao repositório DB (`src/lib/db/loopEngine`):
 * inicia runs, avança um passo por vez (persistindo), para em `awaiting_approval` quando um
 * efeito externo é proposto, e retoma após aprovação humana explícita. NUNCA executa efeito
 * externo — o Policy Engine/aprovações do OmniRoute decidem; a execução real (quando aprovada)
 * fica com os conectores do OmniRoute, fora deste módulo.
 */
import {
  advance,
  createLoopRun,
  proposeStep,
  type AdvanceInput,
  type LoopBudget,
  type LoopProposedEffect,
  type LoopRun,
} from "@omniroute/open-sse/loop-engine/index.ts";

import { getLoopRun, listLoopRuns, saveLoopRun } from "./db/loopEngine";

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
  const run = getLoopRun(runId);
  if (!run) throw new Error(`loop run não encontrado: ${runId}`);
  proposeStep(run, step);
  saveLoopRun(run);
  return run;
}

/**
 * Avança UM passo do run e persiste. Report-only por padrão: um efeito não auto-aprovado
 * para o run em `awaiting_approval` (nada é executado). Retorna o novo estado + nota.
 */
export function advanceRun(
  runId: string,
  input?: Partial<AdvanceInput>
): { run: LoopRun; note: string } {
  const current = getLoopRun(runId);
  if (!current) throw new Error(`loop run não encontrado: ${runId}`);
  const result = advance(current, {
    consumed: input?.consumed,
    verdict: input?.verdict,
    policy: input?.policy ?? { reportOnly: true },
  });
  saveLoopRun(result.run);
  return result;
}

/**
 * Aprova explicitamente uma etapa que estava aguardando aprovação, liberando o run para
 * prosseguir. Só um humano/operador chama isto (via painel/endpoint autenticado).
 */
export function approveStep(runId: string, stepId: string): LoopRun {
  const run = getLoopRun(runId);
  if (!run) throw new Error(`loop run não encontrado: ${runId}`);
  const step = run.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`etapa não encontrada: ${stepId}`);
  step.status = "approved";
  // libera o run que estava parado para aprovação
  if (run.status === "awaiting_approval") run.status = "report_only";
  saveLoopRun(run);
  return run;
}

/** Rejeita uma etapa (marca como rejeitada); o run pode então escalar/abortar no próximo advance. */
export function rejectStep(runId: string, stepId: string): LoopRun {
  const run = getLoopRun(runId);
  if (!run) throw new Error(`loop run não encontrado: ${runId}`);
  const step = run.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`etapa não encontrada: ${stepId}`);
  step.status = "rejected";
  saveLoopRun(run);
  return run;
}

/** Runs que estão parados aguardando aprovação humana (para o painel destacar). */
export function runsAwaitingApproval(): LoopRun[] {
  return listLoopRuns("awaiting_approval");
}

export { getLoopRun, listLoopRuns };
