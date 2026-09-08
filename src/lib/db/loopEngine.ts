/**
 * Repositório do Loop Engine — persistência dos runs/steps (tabelas da migração 174).
 *
 * Torna o núcleo puro (`open-sse/loop-engine`) FUNCIONAL: grava e recarrega o estado no DB
 * do OmniRoute (fonte de verdade). Report-only; nenhum efeito externo aqui.
 */
import type { LoopRun, LoopStep } from "@omniroute/open-sse/loop-engine/index.ts";

import { getDbInstance } from "./core";

/** Tenant único por ora (CLAUDE.md §5.1). Toda leitura/escrita é escopada por ele. */
export const DEFAULT_TENANT = "default";

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

/** Persiste (upsert) um run e todas as suas etapas, de forma transacional. Escopado por tenant. */
export function saveLoopRun(run: LoopRun, tenantId: string = DEFAULT_TENANT): void {
  const db = getDbInstance();
  const tx = db.transaction((r: LoopRun) => {
    db.prepare(
      `INSERT INTO loop_runs (id, tenant_id, pattern, phase, status, budget_json, usage_json, correlation_id, task_id, sequence_number, updated_at)
       VALUES (@id, @tenant_id, @pattern, @phase, @status, @budget_json, @usage_json, @correlation_id, @task_id, @sequence_number, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         phase=excluded.phase, status=excluded.status, usage_json=excluded.usage_json,
         sequence_number=excluded.sequence_number, updated_at=datetime('now')`
    ).run({
      id: r.id,
      tenant_id: tenantId,
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
      `INSERT INTO loop_steps (id, tenant_id, run_id, idx, title, proposed_effect_json, status)
       VALUES (@id, @tenant_id, @run_id, @idx, @title, @proposed_effect_json, @status)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status`
    );
    for (const s of r.steps) {
      upStep.run({
        id: s.id,
        tenant_id: tenantId,
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

/** Carrega um run com suas etapas, ou null se não existir NESTE tenant (isolamento). */
export function getLoopRun(id: string, tenantId: string = DEFAULT_TENANT): LoopRun | null {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT * FROM loop_runs WHERE id = ? AND tenant_id = ?")
    .get(id, tenantId) as LoopRunRow | undefined;
  if (!row) return null;
  const stepRows = db
    .prepare("SELECT * FROM loop_steps WHERE run_id = ? AND tenant_id = ? ORDER BY idx")
    .all(id, tenantId) as LoopStepRow[];
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

/** Lista runs do tenant (opcionalmente por status), mais recentes primeiro. */
export function listLoopRuns(
  status?: LoopRun["status"],
  tenantId: string = DEFAULT_TENANT
): LoopRun[] {
  const db = getDbInstance();
  const rows = (
    status
      ? db
          .prepare(
            "SELECT * FROM loop_runs WHERE tenant_id = ? AND status = ? ORDER BY updated_at DESC"
          )
          .all(tenantId, status)
      : db
          .prepare("SELECT * FROM loop_runs WHERE tenant_id = ? ORDER BY updated_at DESC")
          .all(tenantId)
  ) as LoopRunRow[];
  return rows.map((row) => getLoopRun(row.id, tenantId)!).filter(Boolean);
}
