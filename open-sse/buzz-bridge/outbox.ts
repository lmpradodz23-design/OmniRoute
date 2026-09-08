/**
 * Buzz Bridge — outbox/inbox idempotente (puro).
 *
 * Garante que nenhum evento seja publicado ou processado duas vezes, mesmo com retries.
 * Dedup por `event.id` (saída) e por `event.id` (entrada); ordenação por `sequenceNumber`.
 * Sem dupla fonte de verdade: aqui só orquestramos entrega; o estado durável é do OmniRoute.
 */
import type { BuzzEvent, InboxEntry, OutboxEntry } from "./types.ts";

/** Fila outbox in-memory com dedup determinístico (a persistência real é no DB do OmniRoute). */
export class Outbox {
  private readonly byEventId = new Map<string, OutboxEntry>();
  private seq = 0;

  /** Enfileira um evento para publicação. Idempotente: reenfileirar o mesmo id é no-op. */
  enqueue(params: {
    event: BuzzEvent;
    correlationId: string;
    taskId?: string;
    runId?: string;
  }): OutboxEntry {
    const existing = this.byEventId.get(params.event.id);
    if (existing) return existing;
    const entry: OutboxEntry = {
      id: params.event.id,
      correlationId: params.correlationId,
      sequenceNumber: ++this.seq,
      taskId: params.taskId,
      runId: params.runId,
      event: params.event,
      status: "pending",
      attempts: 0,
    };
    this.byEventId.set(entry.id, entry);
    return entry;
  }

  /** Entradas pendentes, em ordem de sequência (entrega ordenada). */
  pending(): OutboxEntry[] {
    return [...this.byEventId.values()]
      .filter((e) => e.status === "pending")
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  markPublished(id: string): void {
    const e = this.byEventId.get(id);
    if (e) e.status = "published";
  }

  markFailed(id: string): void {
    const e = this.byEventId.get(id);
    if (e) {
      e.status = "failed";
      e.attempts += 1;
    }
  }

  /** Reprograma entradas falhas para nova tentativa (backoff é decidido por quem chama). */
  requeueFailed(): void {
    for (const e of this.byEventId.values()) if (e.status === "failed") e.status = "pending";
  }

  size(): number {
    return this.byEventId.size;
  }
}

/** Lado de entrada: dedup por id de evento; processa cada evento no máximo uma vez. */
export class Inbox {
  private readonly seen = new Set<string>();
  private seq = 0;

  /** Registra um evento recebido. Retorna null se já visto (dedup), senão a entrada. */
  receive(event: BuzzEvent, correlationId: string): InboxEntry | null {
    if (this.seen.has(event.id)) return null;
    this.seen.add(event.id);
    return { event, correlationId, sequenceNumber: ++this.seq, status: "received" };
  }

  seenCount(): number {
    return this.seen.size;
  }
}
