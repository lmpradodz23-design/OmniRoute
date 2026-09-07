/**
 * Repositório do Loop Engine — persistência dos runs/steps (tabelas da migração 175).
 *
 * Torna o núcleo puro (`open-sse/loop-engine`) FUNCIONAL: grava e recarrega o estado no DB
 * do OmniRoute (fonte de verdade). Report-only; nenhum efeito externo aqui.
 */
import type { LoopRun, LoopStep } from "@omniroute/open-sse/loop-engine/index.ts";

import { getDbInstance } from "./core";

interface LoopRunRow {
  id: string;
  pattern: string;
  phase: string;
  status: string;
  budget_json: string;
  usage_json: string;
  correlation_id: string;
  task_id: string | null;
  sequence_number: number;
}

interface LoopStepRow {
  id: string;
  run_id: string;
  idx: number;
  title: string;
  proposed_effect_json: string | null;
  status: string;
}

function rowToRun(row: LoopRunRow, steps: LoopStep[]): LoopRun {
  return {
    id: row.id,
    pattern: row.pattern,
    phase: row.phase as LoopRun["phase"],
    status: row.status as LoopRun["status"],
    budget: JSON.parse(row.budget_json),
    usage: JSON.parse(row.usage_json),
    correlationId: row.correlation_id,
    taskId: row.task_id ?? undefined,
    sequenceNumber: row.sequence_number,
    steps,
  };
}

/** Persiste (upsert) um run e todas as suas etapas, de forma transacional. */
export function saveLoopRun(run: LoopRun): void {
  const db = getDbInstance();
  const tx = db.transaction((r: LoopRun) => {
    db.prepare(
      `INSERT INTO loop_runs (id, pattern, phase, status, budget_json, usage_json, correlation_id, task_id, sequence_number, updated_at)
       VALUES (@id, @pattern, @phase, @status, @budget_json, @usage_json, @correlation_id, @task_id, @sequence_number, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         phase=excluded.phase, status=excluded.status, usage_json=excluded.usage_json,
         sequence_number=excluded.sequence_number, updated_at=datetime('now')`
    ).run({
      id: r.id,
      pattern: r.pattern,
      phase: r.phase,
      status: r.status,
      budget_json: JSON.stringify(r.budget),
      usage_json: JSON.stringify(r.usage),
      correlation_id: r.correlationId,
      task_id: r.taskId ?? null,
      sequence_number: r.sequenceNumber,
    });
    const upStep = db.prepare(
      `INSERT INTO loop_steps (id, run_id, idx, title, proposed_effect_json, status)
       VALUES (@id, @run_id, @idx, @title, @proposed_effect_json, @status)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status`
    );
    for (const s of r.steps) {
      upStep.run({
        id: s.id,
        run_id: r.id,
        idx: s.index,
        title: s.title,
        proposed_effect_json: s.proposedEffect ? JSON.stringify(s.proposedEffect) : null,
        status: s.status,
      });
    }
  });
  tx(run);
}

/** Carrega um run com suas etapas, ou null se não existir. */
export function getLoopRun(id: string): LoopRun | null {
  const db = getDbInstance();
  const row = db.prepare("SELECT * FROM loop_runs WHERE id = ?").get(id) as LoopRunRow | undefined;
  if (!row) return null;
  const stepRows = db
    .prepare("SELECT * FROM loop_steps WHERE run_id = ? ORDER BY idx")
    .all(id) as LoopStepRow[];
  const steps: LoopStep[] = stepRows.map((sr) => ({
    id: sr.id,
    runId: sr.run_id,
    index: sr.idx,
    title: sr.title,
    proposedEffect: sr.proposed_effect_json ? JSON.parse(sr.proposed_effect_json) : undefined,
    status: sr.status as LoopStep["status"],
  }));
  return rowToRun(row, steps);
}

/** Lista runs (opcionalmente por status), mais recentes primeiro. */
export function listLoopRuns(status?: LoopRun["status"]): LoopRun[] {
  const db = getDbInstance();
  const rows = (
    status
      ? db.prepare("SELECT * FROM loop_runs WHERE status = ? ORDER BY updated_at DESC").all(status)
      : db.prepare("SELECT * FROM loop_runs ORDER BY updated_at DESC").all()
  ) as LoopRunRow[];
  return rows.map((row) => getLoopRun(row.id)!).filter(Boolean);
}
