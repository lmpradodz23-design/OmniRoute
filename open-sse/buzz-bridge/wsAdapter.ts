/**
 * Buzz Bridge — WebSocketBuzzAdapter: fala com o buzz-relay (Nostr) via WebSocket.
 *
 * Implementa o contrato BuzzAdapter de verdade: conecta, faz auth NIP-42 (o relay do Buzz
 * tem auth_required), publica eventos assinados (kind/tags/content) e assina filtros.
 * O OmniRoute continua o plano de controle — este adaptador só transporta eventos.
 */
import WebSocket from "ws";

import { finalizeEvent, getPublicKey, verifyEvent, type SignedNostrEvent } from "./nostr.ts";
import type { BuzzAdapter, BuzzEvent, BuzzSubscriptionFilter, OutboxEntry } from "./types.ts";

export interface WebSocketBuzzConfig {
  /** URL do relay, ex.: ws://127.0.0.1:3000 */
  readonly relayUrl: string;
  /** Secret key Nostr (hex) da identidade deste agente. */
  readonly secretKeyHex: string;
  /** Timeout de operações (ms). */
  readonly timeoutMs?: number;
  /** Janela (ms) sem AUTH para assumir relay sem auth_required (default 400). */
  readonly authGraceMs?: number;
  /** Reconectar automaticamente após queda inesperada (default true). */
  readonly autoReconnect?: boolean;
  /** Backoff base da reconexão (ms, default 500). */
  readonly reconnectBaseMs?: number;
  /** Teto do backoff da reconexão (ms, default 15000). */
  readonly reconnectMaxMs?: number;
}

function toBuzzEvent(e: SignedNostrEvent): BuzzEvent {
  return {
    id: e.id,
    pubkey: e.pubkey,
    kind: e.kind,
    createdAt: e.created_at,
    tags: e.tags,
    content: e.content,
    sig: e.sig,
  };
}

export class WebSocketBuzzAdapter implements BuzzAdapter {
  readonly enabled = true;
  readonly pubkey: string;
  private ws?: WebSocket;
  private readonly timeout: number;
  private readonly pendingOk = new Map<string, (ok: boolean) => void>();
  private readonly subs = new Map<
    string,
    { filter: BuzzSubscriptionFilter; onEvent: (e: BuzzEvent) => void }
  >();
  /** Janela (ms) sem AUTH para assumir relay SEM auth_required e liberar o publish. */
  private readonly authGraceMs: number;
  /** Resolvida quando o AUTH (NIP-42) foi confirmado OU o relay não exige auth. publish() espera nela. */
  private authReady: Promise<void> = Promise.resolve();
  private authReadyResolve?: () => void;
  private authGraceTimer?: ReturnType<typeof setTimeout>;
  private authChallengeSeen = false;
  // Reconexão automática (resiliência do consumidor de entrada após uma queda).
  private readonly autoReconnect: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectInFlight?: Promise<void>;

  constructor(private readonly config: WebSocketBuzzConfig) {
    this.pubkey = getPublicKey(config.secretKeyHex);
    this.timeout = config.timeoutMs ?? 8000;
    this.authGraceMs = config.authGraceMs ?? 400;
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectBaseMs = config.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = config.reconnectMaxMs ?? 15000;
  }

  connect(): Promise<void> {
    // Single-flight: uma reconexão automática e um ensureConnected concorrentes compartilham o
    // MESMO connect em andamento (nunca abrimos dois sockets).
    if (this.connectInFlight) return this.connectInFlight;
    this.closedByUser = false;
    this.connectInFlight = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.config.relayUrl);
      this.ws = ws;
      this.authChallengeSeen = false;
      // authReady só resolve quando o relay confirma o AUTH (OK=true do nosso kind 22242) OU quando
      // a janela de graça passa sem nenhum challenge (relay sem auth_required). publish() aguarda nela
      // para NUNCA correr contra o handshake — o que antes fazia o 1º publish falhar e (sem o requeue
      // no DB) estrangular a mensagem para sempre.
      this.authReady = new Promise<void>((res) => {
        this.authReadyResolve = res;
      });
      const openTimer = setTimeout(() => {
        this.connectInFlight = undefined;
        reject(new Error("buzz relay connect timeout"));
      }, this.timeout);
      ws.on("open", () => {
        clearTimeout(openTimer);
        this.reconnectAttempts = 0; // conexão saudável zera o backoff
        this.connectInFlight = undefined;
        this.authGraceTimer = setTimeout(() => {
          if (!this.authChallengeSeen) this.markAuthReady();
        }, this.authGraceMs);
        // Re-emite os REQ das assinaturas ativas — o consumidor sobrevive a uma reconexão.
        for (const [subId, sub] of this.subs) this.sendReq(subId, sub.filter);
        resolve();
      });
      ws.on("error", (e: Error) => {
        clearTimeout(openTimer);
        this.connectInFlight = undefined;
        reject(e);
      });
      ws.on("close", () => this.onSocketClose(ws));
      ws.on("message", (data: WebSocket.RawData) => this.onMessage(data.toString()));
    });
    return this.connectInFlight;
  }

  /**
   * Queda do socket: libera waiters e agenda reconexão (salvo close() explícito). Ignora eventos
   * de um socket OBSOLETO — se já reconectamos, o `close` tardio do socket antigo não pode zerar o
   * novo (senão o publish enviaria para um socket órfão e expiraria).
   */
  private onSocketClose(closed: WebSocket): void {
    if (this.ws !== closed) return; // close tardio de um socket já substituído
    this.ws = undefined;
    this.markAuthReady(); // não deixa um publish preso esperando authReady de um socket morto
    if (this.closedByUser || !this.autoReconnect) return;
    this.scheduleReconnect();
  }

  /** Reconexão com backoff exponencial + jitter, com teto. Um timer por vez. */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUser) return;
    const backoff = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempts,
      this.reconnectMaxMs
    );
    const delay = backoff + Math.floor(Math.random() * this.reconnectBaseMs);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  /** Libera o publish (AUTH confirmado ou dispensado). Idempotente. */
  private markAuthReady(): void {
    if (this.authGraceTimer) {
      clearTimeout(this.authGraceTimer);
      this.authGraceTimer = undefined;
    }
    this.authReadyResolve?.();
    this.authReadyResolve = undefined;
  }

  /** Reconecta sob demanda se o socket não estiver aberto (ex.: queda entre flushes). */
  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    await this.connect();
  }

  private send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private onMessage(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg.length === 0) return;
    const type = msg[0];

    if (type === "AUTH" && typeof msg[1] === "string") {
      // NIP-42: relay exige auth. Cancela a graça (não vamos "assumir sem auth") e só libera o
      // publish quando o relay confirmar nosso evento de auth (OK=true do id abaixo).
      this.authChallengeSeen = true;
      if (this.authGraceTimer) {
        clearTimeout(this.authGraceTimer);
        this.authGraceTimer = undefined;
      }
      const authEvent = finalizeEvent(
        {
          created_at: Math.floor(Date.now() / 1000),
          kind: 22242,
          tags: [
            ["relay", this.config.relayUrl],
            ["challenge", msg[1]],
          ],
          content: "",
        },
        this.config.secretKeyHex
      );
      // Quando o OK do nosso auth chegar com sucesso, libera authReady. Se vier false, não libera:
      // os publishes vão expirar → 'failed' → requeue no próximo flush (backstop durável).
      this.pendingOk.set(authEvent.id, (ok) => {
        if (ok) this.markAuthReady();
      });
      this.send(["AUTH", authEvent]);
      return;
    }
    if (type === "OK" && typeof msg[1] === "string") {
      const resolver = this.pendingOk.get(msg[1]);
      if (resolver) {
        resolver(Boolean(msg[2]));
        this.pendingOk.delete(msg[1]);
      }
      return;
    }
    if (type === "EVENT" && typeof msg[1] === "string") {
      const sub = this.subs.get(msg[1]);
      const ev = msg[2] as SignedNostrEvent | undefined;
      if (sub && ev && verifyEvent(ev)) sub.onEvent(toBuzzEvent(ev));
    }
  }

  private sendReq(subId: string, filter: BuzzSubscriptionFilter): void {
    const f: Record<string, unknown> = {};
    if (filter.kinds) f.kinds = filter.kinds;
    if (filter.since) f.since = filter.since;
    if (filter.channelId) f["#e"] = [filter.channelId];
    this.send(["REQ", subId, f]);
  }

  /**
   * Publica o evento do outbox, RE-ASSINANDO com a chave deste agente (o pubkey do produtor é
   * ignorado por design — "uma chave Nostr nunca autoriza ação"; a autoria de saída é sempre do
   * agente OmniRoute). Usa o createdAt PERSISTIDO no enqueue (nunca o relógio) para que re-tentativas
   * produzam o mesmo id → dedup real do relay. Retorna true se o relay aceitou.
   */
  async publish(entry: OutboxEntry): Promise<boolean> {
    await this.ensureConnected(); // reconecta se o socket caiu entre flushes
    await this.authReady; // não corre contra o handshake NIP-42
    const signed = finalizeEvent(
      {
        created_at: entry.event.createdAt,
        kind: entry.event.kind,
        tags: entry.event.tags.map((t) => [...t]),
        content: entry.event.content,
      },
      this.config.secretKeyHex
    );
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingOk.delete(signed.id);
        resolve(false);
      }, this.timeout);
      this.pendingOk.set(signed.id, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      this.send(["EVENT", signed]);
    });
  }

  async subscribe(filter: BuzzSubscriptionFilter, onEvent: (e: BuzzEvent) => void): Promise<void> {
    await this.ensureConnected(); // reconecta se necessário antes de assinar
    const subId = "sub-" + Math.random().toString(36).slice(2, 10);
    this.subs.set(subId, { filter, onEvent });
    this.sendReq(subId, filter);
  }

  async close(): Promise<void> {
    // Fecho explícito: desliga a reconexão automática, cancela timers e libera waiters.
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.markAuthReady();
    this.ws?.close();
  }
}
