/**
 * Repositório do Buzz Bridge — persistência do outbox/inbox (migrações 175 + 176).
 *
 * Torna a ponte funcional mesmo com o relay AUSENTE: os eventos de saída ficam duráveis no
 * outbox até haver relay + flag ON; os de entrada são deduplicados no inbox. Idempotente.
 *
 * Retry (auditoria A-H3): uma entrada `failed` volta a ser elegível depois de um backoff
 * exponencial com jitter (`next_attempt_at`), até OUTBOX_MAX_ATTEMPTS; a partir daí fica
 * `failed` em definitivo (visível no painel como falha), sem novas tentativas automáticas.
 */
import type { BuzzEvent, InboxEntry, OutboxEntry } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { getDbInstance } from "./core";
import { DEFAULT_TENANT } from "./loopEngine";

/** Tentativas totais (1 inicial + 4 retentativas) antes de uma entrada ficar `failed` definitiva. */
export const OUTBOX_MAX_ATTEMPTS = 5;
/** Backoff base (1ª retentativa ≈ 30 s), dobrando a cada falha até o teto. */
export const OUTBOX_RETRY_BASE_MS = 30_000;
/** Teto do backoff (30 min). */
export const OUTBOX_RETRY_MAX_MS = 30 * 60_000;

interface OutboxRow {
  id: string;
  correlation_id: string;
  sequence_number: number;
  task_id: string | null;
  run_id: string | null;
  event_json: string;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    sequenceNumber: row.sequence_number,
    taskId: row.task_id ?? undefined,
    runId: row.run_id ?? undefined,
    event: JSON.parse(row.event_json),
    status: row.status as OutboxEntry["status"],
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at ?? null,
  };
}

/**
 * Atraso até a próxima tentativa após `attempts` falhas: exponencial (base × 2^(n−1)) com
 * jitter de ±25 % e teto. `random` é injetável para testes determinísticos.
 */
export function outboxRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  const exponential = Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** exponent);
  const jitter = 0.75 + random() * 0.5;
  return Math.round(Math.min(OUTBOX_RETRY_MAX_MS, exponential * jitter));
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
  return toEntry(row);
}

/**
 * Entradas elegíveis para publicação no tenant, em ordem de sequência (entrega ordenada):
 * `pending`, mais as `failed` com tentativas restantes cujo backoff já venceu em `now`.
 */
export function pendingOutbox(
  limit = 100,
  tenantId: string = DEFAULT_TENANT,
  now: number = Date.now()
): OutboxEntry[] {
  const rows = getDbInstance()
    .prepare(
      `SELECT * FROM buzz_outbox
       WHERE tenant_id = ?
         AND (status = 'pending'
              OR (status = 'failed' AND attempts < ?
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)))
       ORDER BY sequence_number LIMIT ?`
    )
    .all(tenantId, OUTBOX_MAX_ATTEMPTS, new Date(now).toISOString(), limit) as OutboxRow[];
  return rows.map(toEntry);
}

/**
 * Marca o resultado de uma tentativa. `failed` incrementa `attempts` e agenda `next_attempt_at`
 * com backoff exponencial + jitter a partir de `now` (injetável para testes).
 */
export function markOutbox(
  id: string,
  status: "published" | "failed",
  now: number = Date.now()
): void {
  const db = getDbInstance();
  if (status === "published") {
    db.prepare("UPDATE buzz_outbox SET status='published', next_attempt_at=NULL WHERE id=?").run(
      id
    );
    return;
  }
  const current = db.prepare("SELECT attempts FROM buzz_outbox WHERE id = ?").get(id) as
    { attempts: number } | undefined;
  const attempts = (current?.attempts ?? 0) + 1;
  if (attempts >= OUTBOX_MAX_ATTEMPTS) {
    // Terminal: a distinct `dead` status keeps permanent failures apart from the transient
    // `failed` ones still scheduled for retry (panel counters, cleanup) — review consensus.
    db.prepare(
      "UPDATE buzz_outbox SET status='dead', attempts=?, next_attempt_at=NULL WHERE id=?"
    ).run(attempts, id);
    return;
  }
  const nextAttemptAt = new Date(now + outboxRetryDelayMs(attempts)).toISOString();
  db.prepare(
    "UPDATE buzz_outbox SET status='failed', attempts=?, next_attempt_at=? WHERE id=?"
  ).run(attempts, nextAttemptAt, id);
}

export interface BuzzCounts {
  outboxPending: number;
  outboxPublished: number;
  /** Transient failures still scheduled for retry. */
  outboxFailed: number;
  /** Permanent failures: retry ceiling reached, never retried automatically. */
  outboxDead: number;
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
    outboxDead: count(
      "SELECT COUNT(*) AS n FROM buzz_outbox WHERE tenant_id = ? AND status = 'dead'"
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
