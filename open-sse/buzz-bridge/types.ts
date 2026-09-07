/**
 * Buzz Bridge — tipos e contratos (ponte OmniRoute ↔ Block Buzz).
 *
 * Buzz (github.com/block/buzz, Apache-2.0, SHA 3c7f288…) é um serviço SEPARADO: um relay
 * Nostr (NIP-01) onde cada ação é um evento assinado identificado por `kind`. O relay é a
 * fonte única de verdade APENAS de canais, conversas, membros e eventos colaborativos.
 *
 * O OmniRoute permanece plano de controle e dono das políticas. Regras não-negociáveis:
 *  - Uma chave Nostr (`buzz_pubkey`) NÃO autoriza nenhuma ação no OmniRoute.
 *  - Toda ponte é idempotente (outbox/inbox, sequence_number, correlation_id, dedup).
 *  - Não criar dupla fonte de verdade: estado de tarefas/runs/aprovações vive no OmniRoute.
 *
 * Este módulo fica atrás da feature flag `buzz_hub` (OFF por padrão). Sem o relay rodando,
 * o adaptador é inerte (não conecta); as entradas ficam no outbox até haver relay + flag ON.
 */

/** Evento colaborativo (shape derivado de NIP-01: id, pubkey, kind, tags, content, sig). */
export interface BuzzEvent {
  /** id do evento (hash) — chave de deduplicação. */
  readonly id: string;
  /** pubkey Nostr do autor (humano ou agente). NUNCA é autorização no OmniRoute. */
  readonly pubkey: string;
  /** kind NIP-01 (inteiro) — nova feature = novo kind. */
  readonly kind: number;
  readonly createdAt: number; // epoch seconds
  readonly tags: ReadonlyArray<ReadonlyArray<string>>;
  readonly content: string;
  readonly sig?: string;
}

/** Mapeamento de identidade — o OmniRoute é dono; buzz_pubkey é só um atributo. */
export interface BuzzIdentityMapping {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly buzzPubkey: string;
}

/** Entrada de saída (OmniRoute → Buzz), aguardando publicação idempotente no relay. */
export interface OutboxEntry {
  readonly id: string; // id lógico local (dedup)
  readonly correlationId: string;
  readonly sequenceNumber: number;
  readonly taskId?: string;
  readonly runId?: string;
  readonly event: BuzzEvent;
  status: "pending" | "published" | "failed";
  attempts: number;
}

/** Entrada de entrada (Buzz → OmniRoute), aguardando processamento idempotente. */
export interface InboxEntry {
  readonly event: BuzzEvent;
  readonly correlationId: string;
  readonly sequenceNumber: number;
  status: "received" | "processed" | "ignored";
}

/**
 * Contrato do adaptador tipado. NÃO há chamadas ao relay espalhadas pelo código —
 * tudo passa por esta interface. Implementações: DisabledBuzzAdapter (flag OFF) e,
 * futuramente, WebSocketBuzzAdapter (quando o relay rodar + flag ON).
 */
export interface BuzzAdapter {
  readonly enabled: boolean;
  /** Conecta ao relay (WebSocket). No-op quando desabilitado. */
  connect(): Promise<void>;
  /** Publica um evento já enfileirado no outbox. Retorna true se publicado. */
  publish(entry: OutboxEntry): Promise<boolean>;
  /** Assina um filtro (channel/kind) e entrega eventos ao callback. */
  subscribe(filter: BuzzSubscriptionFilter, onEvent: (e: BuzzEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export interface BuzzSubscriptionFilter {
  readonly kinds?: ReadonlyArray<number>;
  readonly channelId?: string;
  readonly since?: number;
}
