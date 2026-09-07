/**
 * Repositório do Buzz Bridge — persistência do outbox/inbox (tabelas da migração 175).
 *
 * Torna a ponte funcional mesmo com o relay AUSENTE: os eventos de saída ficam duráveis no
 * outbox até haver relay + flag ON; os de entrada são deduplicados no inbox. Idempotente.
 */
import type { BuzzEvent, InboxEntry, OutboxEntry } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { getDbInstance } from "./core";

interface OutboxRow {
  id: string;
  correlation_id: string;
  sequence_number: number;
  task_id: string | null;
  run_id: string | null;
  event_json: string;
  status: string;
  attempts: number;
}

/** Enfileira um evento de saída (idempotente por event.id). Retorna a entrada. */
export function enqueueOutbox(params: {
  event: BuzzEvent;
  correlationId: string;
  taskId?: string;
  runId?: string;
}): OutboxEntry {
  const db = getDbInstance();
  const nextSeq =
    (
      db.prepare("SELECT COALESCE(MAX(sequence_number),0) AS m FROM buzz_outbox").get() as {
        m: number;
      }
    ).m + 1;
  db.prepare(
    `INSERT INTO buzz_outbox (id, correlation_id, sequence_number, task_id, run_id, event_json, status, attempts)
     VALUES (@id, @correlation_id, @sequence_number, @task_id, @run_id, @event_json, 'pending', 0)
     ON CONFLICT(id) DO NOTHING`
  ).run({
    id: params.event.id,
    correlation_id: params.correlationId,
    sequence_number: nextSeq,
    task_id: params.taskId ?? null,
    run_id: params.runId ?? null,
    event_json: JSON.stringify(params.event),
  });
  const row = db
    .prepare("SELECT * FROM buzz_outbox WHERE id = ?")
    .get(params.event.id) as OutboxRow;
  return {
    id: row.id,
    correlationId: row.correlation_id,
    sequenceNumber: row.sequence_number,
    taskId: row.task_id ?? undefined,
    runId: row.run_id ?? undefined,
    event: JSON.parse(row.event_json),
    status: row.status as OutboxEntry["status"],
    attempts: row.attempts,
  };
}

/** Entradas pendentes do outbox, em ordem de sequência (entrega ordenada). */
export function pendingOutbox(limit = 100): OutboxEntry[] {
  const rows = getDbInstance()
    .prepare("SELECT * FROM buzz_outbox WHERE status = 'pending' ORDER BY sequence_number LIMIT ?")
    .all(limit) as OutboxRow[];
  return rows.map((row) => ({
    id: row.id,
    correlationId: row.correlation_id,
    sequenceNumber: row.sequence_number,
    taskId: row.task_id ?? undefined,
    runId: row.run_id ?? undefined,
    event: JSON.parse(row.event_json),
    status: row.status as OutboxEntry["status"],
    attempts: row.attempts,
  }));
}

export function markOutbox(id: string, status: "published" | "failed"): void {
  const db = getDbInstance();
  if (status === "failed") {
    db.prepare("UPDATE buzz_outbox SET status='failed', attempts=attempts+1 WHERE id=?").run(id);
  } else {
    db.prepare("UPDATE buzz_outbox SET status='published' WHERE id=?").run(id);
  }
}

/**
 * Registra um evento recebido (dedup por event.id). Retorna null se já visto — garante
 * processamento no máximo uma vez, mesmo com reentrega do relay.
 */
export function receiveInbox(event: BuzzEvent, correlationId: string): InboxEntry | null {
  const db = getDbInstance();
  const nextSeq =
    (
      db.prepare("SELECT COALESCE(MAX(sequence_number),0) AS m FROM buzz_inbox").get() as {
        m: number;
      }
    ).m + 1;
  const res = db
    .prepare(
      `INSERT INTO buzz_inbox (event_id, correlation_id, sequence_number, event_json, status)
       VALUES (?, ?, ?, ?, 'received') ON CONFLICT(event_id) DO NOTHING`
    )
    .run(event.id, correlationId, nextSeq, JSON.stringify(event));
  if (res.changes === 0) return null; // ja visto
  return { event, correlationId, sequenceNumber: nextSeq, status: "received" };
}
