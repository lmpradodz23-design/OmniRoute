/**
 * Repositório do Loop Engine — persistência dos runs/steps (tabelas da migração 175).
 *
 * Torna o núcleo puro (`open-sse/loop-engine`) FUNCIONAL: grava e recarrega o estado no DB
 * do OmniRoute (fonte de verdade). Report-only; nenhum efeito externo aqui.
 *
 * Concorrência: `sequence_number` é a VERSÃO do run. Toda gravação de um run existente é um
 * UPDATE guardado por `sequence_number = @expected` (otimista) — 0 linhas afetadas significa
 * que outro escritor (mesmo processo ou outro) gravou antes: a escrita é descartada com
 * `LoopRunConflictError` em vez de last-writer-wins.
 */
import type { LoopRun, LoopStep } from "@omniroute/open-sse/loop-engine/index.ts";

import { getDbInstance } from "./core";

/** Tenant único por ora (CLAUDE.md §5.1). Toda leitura/escrita é escopada por ele. */
export const DEFAULT_TENANT = "default";

/** A versão persistida do run não é a esperada: outro escritor gravou antes (escrita descartada). */
export class LoopRunConflictError extends Error {
  readonly code = "LOOP_RUN_CONFLICT";

  constructor(
    readonly runId: string,
    readonly expectedSequenceNumber: number
  ) {
    super(
      `loop run ${runId}: sequence_number esperado ${expectedSequenceNumber}, mas o run mudou desde a leitura (escrita descartada)`
    );
    this.name = "LoopRunConflictError";
  }
}

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
  created_at: string;
}

interface LoopStepRow {
  id: string;
  run_id: string;
  idx: number;
  title: string;
  proposed_effect_json: string | null;
  status: string;
}

/**
 * `created_at` é gravado por nós em ISO 8601 (com 'Z'); linhas criadas pelo DEFAULT da coluna
 * vêm no formato do SQLite `datetime('now')` ("YYYY-MM-DD HH:MM:SS", UTC sem 'Z'), que o
 * `Date.parse` interpretaria como hora local — normaliza antes.
 */
function parseCreatedAt(raw: string): number {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  return Date.parse(iso);
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
    createdAt: parseCreatedAt(row.created_at),
    steps,
  };
}

/**
 * Executa `fn` numa transação do DB: a leitura-modificação-escrita de um run fica atômica
 * dentro do processo; entre processos a guarda otimista de `saveLoopRun` decide.
 */
export function withLoopTransaction<T>(fn: () => T): T {
  return getDbInstance().transaction(fn)();
}

/**
 * Persiste um run e todas as suas etapas, de forma transacional e escopada por tenant.
 *
 * Run novo → INSERT. Run existente → UPDATE guardado por tenant E por versão
 * (`sequence_number = expectedSequenceNumber`, por padrão a versão anterior à do objeto,
 * já que toda mutação persistida incrementa `sequenceNumber`). Se a linha existir mas a
 * guarda não casar (outro escritor gravou antes, ou o id pertence a outro tenant), nada é
 * gravado e `LoopRunConflictError` é lançado.
 */
export function saveLoopRun(
  run: LoopRun,
  tenantId: string = DEFAULT_TENANT,
  expectedSequenceNumber: number = run.sequenceNumber - 1
): void {
  const db = getDbInstance();
  const tx = db.transaction((r: LoopRun, expected: number) => {
    const result = db
      .prepare(
        `INSERT INTO loop_runs (id, tenant_id, pattern, phase, status, budget_json, usage_json, correlation_id, task_id, sequence_number, created_at, updated_at)
         VALUES (@id, @tenant_id, @pattern, @phase, @status, @budget_json, @usage_json, @correlation_id, @task_id, @sequence_number, @created_at, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           phase=excluded.phase, status=excluded.status, usage_json=excluded.usage_json,
           sequence_number=excluded.sequence_number, updated_at=datetime('now')
         WHERE loop_runs.tenant_id = excluded.tenant_id
           AND loop_runs.sequence_number = @expected_sequence_number`
      )
      .run({
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
        created_at: new Date(r.createdAt).toISOString(),
        expected_sequence_number: expected,
      });
    if (result.changes === 0) throw new LoopRunConflictError(r.id, expected);

    const upStep = db.prepare(
      `INSERT INTO loop_steps (id, tenant_id, run_id, idx, title, proposed_effect_json, status)
       VALUES (@id, @tenant_id, @run_id, @idx, @title, @proposed_effect_json, @status)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status
       WHERE loop_steps.tenant_id = excluded.tenant_id`
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
  tx(run, expectedSequenceNumber);
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
