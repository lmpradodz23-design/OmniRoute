/**
 * Repositório do Buzz Bridge — persistência do outbox/inbox (tabelas da migração 174).
 *
 * Torna a ponte funcional mesmo com o relay AUSENTE: os eventos de saída ficam duráveis no
 * outbox até haver relay + flag ON; os de entrada são deduplicados no inbox. Idempotente.
 */
import type { BuzzEvent, InboxEntry, OutboxEntry } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { getDbInstance } from "./core";
import { DEFAULT_TENANT } from "./loopEngine";

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

/** Enfileira um evento de saída (idempotente por event.id). Retorna a entrada. Escopado por tenant. */
export function enqueueOutbox(params: {
  event: BuzzEvent;
  correlationId: string;
  taskId?: string;
  runId?: string;
  tenantId?: string;
}): OutboxEntry {
  const db = getDbInstance();
  const tenantId = params.tenantId ?? DEFAULT_TENANT;
  // Carimba createdAt UMA vez no enqueue (se ausente) e persiste, para a publicação re-assinar
  // sempre com o MESMO timestamp → mesmo id Nostr → dedup real do relay entre re-tentativas.
  const event: BuzzEvent = {
    ...params.event,
    createdAt: params.event.createdAt || Math.floor(Date.now() / 1000),
  };
  const nextSeq =
    (
      db
        .prepare(
          "SELECT COALESCE(MAX(sequence_number),0) AS m FROM buzz_outbox WHERE tenant_id = ?"
        )
        .get(tenantId) as { m: number }
    ).m + 1;
  db.prepare(
    `INSERT INTO buzz_outbox (id, tenant_id, correlation_id, sequence_number, task_id, run_id, event_json, status, attempts)
     VALUES (@id, @tenant_id, @correlation_id, @sequence_number, @task_id, @run_id, @event_json, 'pending', 0)
     ON CONFLICT(id) DO NOTHING`
  ).run({
    id: event.id,
    tenant_id: tenantId,
    correlation_id: params.correlationId,
    sequence_number: nextSeq,
    task_id: params.taskId ?? null,
    run_id: params.runId ?? null,
    event_json: JSON.stringify(event),
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

/** Entradas pendentes do outbox do tenant, em ordem de sequência (entrega ordenada). */
export function pendingOutbox(limit = 100, tenantId: string = DEFAULT_TENANT): OutboxEntry[] {
  const rows = getDbInstance()
    .prepare(
      "SELECT * FROM buzz_outbox WHERE tenant_id = ? AND status = 'pending' ORDER BY sequence_number LIMIT ?"
    )
    .all(tenantId, limit) as OutboxRow[];
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

/** Teto de re-tentativas de publicação antes de desistir (evita loop infinito num relay quebrado). */
export const MAX_OUTBOX_ATTEMPTS = 5;

/**
 * Reenfileira entradas 'failed' que ainda estão sob o teto de tentativas (failed -> pending), para
 * o próximo flush tentar publicar de novo. Falhas costumam ser transitórias (relay fora do ar,
 * corrida com o AUTH do NIP-42); sem isto a entrada ficaria presa em 'failed' para sempre. As que
 * estouraram o teto permanecem 'failed' (não voltam). Retorna quantas foram reenfileiradas.
 * Escopado por tenant. Idempotente por id (o dedup do relay cobre uma eventual republicação dupla).
 */
export function requeueFailedOutbox(
  tenantId: string = DEFAULT_TENANT,
  maxAttempts: number = MAX_OUTBOX_ATTEMPTS
): number {
  const res = getDbInstance()
    .prepare(
      "UPDATE buzz_outbox SET status='pending' WHERE tenant_id = ? AND status='failed' AND attempts < ?"
    )
    .run(tenantId, maxAttempts);
  return res.changes;
}

export interface BuzzCounts {
  outboxPending: number;
  outboxPublished: number;
  outboxFailed: number;
  inboxReceived: number;
}

/** Contagens do outbox/inbox do tenant para o painel único. Zero se as tabelas não existem. */
export function buzzCounts(tenantId: string = DEFAULT_TENANT): BuzzCounts {
  const db = getDbInstance();
  const count = (sql: string): number => {
    try {
      return (db.prepare(sql).get(tenantId) as { n: number }).n;
    } catch {
      return 0; // tabela ausente num DB mínimo — reporta 0 em vez de quebrar o painel
    }
  };
  return {
    outboxPending: count(
      "SELECT COUNT(*) AS n FROM buzz_outbox WHERE tenant_id = ? AND status = 'pending'"
    ),
    outboxPublished: count(
      "SELECT COUNT(*) AS n FROM buzz_outbox WHERE tenant_id = ? AND status = 'published'"
    ),
    outboxFailed: count(
      "SELECT COUNT(*) AS n FROM buzz_outbox WHERE tenant_id = ? AND status = 'failed'"
    ),
    inboxReceived: count("SELECT COUNT(*) AS n FROM buzz_inbox WHERE tenant_id = ?"),
  };
}

/**
 * Registra um evento recebido (dedup por event.id). Retorna null se já visto — garante
 * processamento no máximo uma vez, mesmo com reentrega do relay. Escopado por tenant.
 */
export function receiveInbox(
  event: BuzzEvent,
  correlationId: string,
  tenantId: string = DEFAULT_TENANT
): InboxEntry | null {
  const db = getDbInstance();
  const nextSeq =
    (
      db
        .prepare("SELECT COALESCE(MAX(sequence_number),0) AS m FROM buzz_inbox WHERE tenant_id = ?")
        .get(tenantId) as { m: number }
    ).m + 1;
  const res = db
    .prepare(
      `INSERT INTO buzz_inbox (event_id, tenant_id, correlation_id, sequence_number, event_json, status)
       VALUES (?, ?, ?, ?, ?, 'received') ON CONFLICT(event_id) DO NOTHING`
    )
    .run(event.id, tenantId, correlationId, nextSeq, JSON.stringify(event));
  if (res.changes === 0) return null; // ja visto
  return { event, correlationId, sequenceNumber: nextSeq, status: "received" };
}
