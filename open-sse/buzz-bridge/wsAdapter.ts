/**
 * Buzz Bridge — WebSocketBuzzAdapter: fala com o buzz-relay (Nostr) via WebSocket.
 *
 * Implementa o contrato BuzzAdapter de verdade: conecta, faz auth NIP-42 (o relay do Buzz
 * tem auth_required), publica eventos assinados (kind/tags/content) e assina filtros.
 * O OmniRoute continua o plano de controle — este adaptador só transporta eventos.
 *
 * Hardening (auditoria A-H3 / B-M3):
 *  - `connect()` só resolve depois do `OK` do evento AUTH (kind 22242) — ou, se o relay nunca
 *    desafiar, após a janela `authTimeoutMs` — nunca em 400 ms fixos;
 *  - frames limitados a 1 MiB (`maxPayload`), sem compressão negociada (`perMessageDeflate: false`);
 *  - todo EVENT recebido passa por `isWellFormedRelayEvent` (kind esperado, content ≤ 64 KiB, tags
 *    limitadas) ANTES de verificar assinatura ou persistir;
 *  - `publish()` é guardado por `readyState` (nunca lança); `close()` limpa timers e resolve os
 *    `pendingOk` com `false`; todos os timers são `unref` para não segurar o processo.
 */
import WebSocket from "ws";

import { isWellFormedRelayEvent, MAX_RELAY_FRAME_BYTES } from "./eventShape.ts";
import { finalizeEvent, getPublicKey, verifyEvent, type SignedNostrEvent } from "./nostr.ts";
import { validateBuzzRelayUrl } from "./relayUrl.ts";
import type { BuzzAdapter, BuzzEvent, BuzzSubscriptionFilter, OutboxEntry } from "./types.ts";

export interface WebSocketBuzzConfig {
  /** URL do relay, ex.: ws://127.0.0.1:3000 (validada por `validateBuzzRelayUrl`). */
  readonly relayUrl: string;
  /** Secret key Nostr (hex) da identidade deste agente. */
  readonly secretKeyHex: string;
  /** Timeout de operações (connect/publish), em ms. Default 8000. */
  readonly timeoutMs?: number;
  /** Janela para o relay enviar o desafio AUTH (NIP-42) após o open. Default 3000. */
  readonly authTimeoutMs?: number;
  /**
   * Chamado quando uma conexão já aberta cai (não é chamado em `close()` explícito). `reason` é
   * o motivo do peer ou, quando o fechamento veio de um erro local (ex.: frame acima de
   * `maxPayload`), o código do erro (`WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`).
   */
  readonly onClose?: (info: { code: number; reason: string }) => void;
}

export const DEFAULT_BUZZ_TIMEOUT_MS = 8000;
export const DEFAULT_BUZZ_AUTH_TIMEOUT_MS = 3000;

interface PendingOk {
  resolve: (ok: boolean) => void;
  timer: NodeJS.Timeout;
}

interface Subscription {
  onEvent: (e: BuzzEvent) => void;
  kinds?: ReadonlyArray<number>;
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

function unrefTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
  timer.unref?.();
  return timer;
}

export class WebSocketBuzzAdapter implements BuzzAdapter {
  readonly enabled = true;
  readonly pubkey: string;
  private ws?: WebSocket;
  private readonly timeout: number;
  private readonly authTimeout: number;
  private readonly pendingOk = new Map<string, PendingOk>();
  private readonly subs = new Map<string, Subscription>();
  private authEventId: string | null = null;
  private authSettle: (() => void) | null = null;
  private opened = false;
  private closedByUser = false;
  private isAuthenticated = false;
  private lastErrorCode = "";

  constructor(private readonly config: WebSocketBuzzConfig) {
    const check = validateBuzzRelayUrl(config.relayUrl);
    if (check.ok === false) throw new Error(`buzz relay URL rejected: ${check.code}`);
    this.pubkey = getPublicKey(config.secretKeyHex);
    this.timeout = config.timeoutMs ?? DEFAULT_BUZZ_TIMEOUT_MS;
    this.authTimeout = config.authTimeoutMs ?? DEFAULT_BUZZ_AUTH_TIMEOUT_MS;
  }

  /** True after the relay accepted our NIP-42 AUTH event on the current connection. */
  get authenticated(): boolean {
    return this.isAuthenticated;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      return Promise.reject(new Error("buzz adapter already connecting or connected"));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.config.relayUrl, {
        maxPayload: MAX_RELAY_FRAME_BYTES,
        perMessageDeflate: false,
        handshakeTimeout: this.timeout,
      });
      this.ws = ws;
      this.opened = false;
      this.closedByUser = false;
      this.isAuthenticated = false;
      this.authEventId = null;
      this.lastErrorCode = "";

      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        this.authSettle = null;
        if (err) reject(err);
        else resolve();
      };
      const openTimer = unrefTimer(
        setTimeout(() => {
          finish(new Error("buzz relay connect timeout"));
          ws.terminate();
        }, this.timeout)
      );

      ws.on("open", () => {
        this.opened = true;
        clearTimeout(openTimer);
        // NIP-42: hold `connect()` until the AUTH round-trip completes. A relay that never
        // challenges releases it after the grace window (publishes still work unauthenticated).
        const authTimer = unrefTimer(setTimeout(() => finish(), this.authTimeout));
        this.authSettle = () => {
          clearTimeout(authTimer);
          finish();
        };
      });
      ws.on("error", (e: Error) => {
        const code = (e as { code?: unknown }).code;
        this.lastErrorCode = typeof code === "string" ? code : e.name;
        finish(e);
      });
      ws.on("close", (code: number, reason: Buffer) => {
        finish(new Error(`buzz relay closed before ready (${code})`));
        this.handleClose(code, reason.toString());
      });
      ws.on("message", (data: WebSocket.RawData) => this.onMessage(data.toString()));
    });
  }

  private sendRaw(msg: unknown): boolean {
    if (!this.isOpen()) return false;
    try {
      this.ws?.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private handleClose(code: number, reason: string): void {
    const wasOpen = this.opened;
    this.opened = false;
    this.isAuthenticated = false;
    this.ws?.removeAllListeners();
    this.ws = undefined;
    this.settlePendingPublishes();
    this.subs.clear();
    if (wasOpen && !this.closedByUser) {
      this.config.onClose?.({ code, reason: reason || this.lastErrorCode });
    }
  }

  private settlePendingPublishes(): void {
    for (const [id, pending] of this.pendingOk) {
      clearTimeout(pending.timer);
      this.pendingOk.delete(id);
      pending.resolve(false);
    }
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
    if (type === "AUTH" && typeof msg[1] === "string") return this.answerAuthChallenge(msg[1]);
    if (type === "OK" && typeof msg[1] === "string") return this.onOk(msg[1], Boolean(msg[2]));
    if (type === "EVENT" && typeof msg[1] === "string") return this.onEvent(msg[1], msg[2]);
  }

  /** NIP-42: responde ao challenge com um evento kind 22242 assinado. */
  private answerAuthChallenge(challenge: string): void {
    const authEvent = finalizeEvent(
      {
        created_at: Math.floor(Date.now() / 1000),
        kind: 22242,
        tags: [
          ["relay", this.config.relayUrl],
          ["challenge", challenge],
        ],
        content: "",
      },
      this.config.secretKeyHex
    );
    this.authEventId = authEvent.id;
    this.sendRaw(["AUTH", authEvent]);
  }

  private onOk(eventId: string, ok: boolean): void {
    if (eventId === this.authEventId) {
      this.isAuthenticated = ok;
      this.authEventId = null;
      this.authSettle?.();
      return;
    }
    const pending = this.pendingOk.get(eventId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOk.delete(eventId);
    pending.resolve(ok);
  }

  private onEvent(subId: string, payload: unknown): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    // Shape first (cheap, bounded), signature second (expensive), delivery last.
    if (!isWellFormedRelayEvent(payload, sub.kinds)) return;
    if (!verifyEvent(payload)) return;
    sub.onEvent(toBuzzEvent(payload));
  }

  /**
   * Publica o evento do outbox, RE-ASSINANDO com a chave deste agente (o pubkey do produtor é
   * ignorado por design — "uma chave Nostr nunca autoriza ação"; a autoria de saída é sempre do
   * agente OmniRoute). Usa o createdAt PERSISTIDO no enqueue (nunca o relógio) para que re-tentativas
   * produzam o mesmo id → dedup real do relay. Retorna true se o relay aceitou; false em timeout,
   * socket fechado ou rejeição — nunca lança.
   */
  async publish(entry: OutboxEntry): Promise<boolean> {
    if (!this.isOpen()) return false;
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
      const timer = unrefTimer(
        setTimeout(() => {
          this.pendingOk.delete(signed.id);
          resolve(false);
        }, this.timeout)
      );
      this.pendingOk.set(signed.id, { resolve, timer });
      if (!this.sendRaw(["EVENT", signed])) {
        clearTimeout(timer);
        this.pendingOk.delete(signed.id);
        resolve(false);
      }
    });
  }

  async subscribe(filter: BuzzSubscriptionFilter, onEvent: (e: BuzzEvent) => void): Promise<void> {
    if (!this.isOpen()) throw new Error("buzz relay not connected");
    const subId = "sub-" + Math.random().toString(36).slice(2, 10);
    this.subs.set(subId, { onEvent, kinds: filter.kinds });
    const f: Record<string, unknown> = {};
    if (filter.kinds) f.kinds = filter.kinds;
    if (filter.since) f.since = filter.since;
    if (filter.channelId) f["#e"] = [filter.channelId];
    if (!this.sendRaw(["REQ", subId, f])) {
      this.subs.delete(subId);
      throw new Error("buzz relay subscription could not be sent");
    }
  }

  /** Fecha a conexão, limpa timers e resolve publicações pendentes com `false`. Idempotente. */
  async close(): Promise<void> {
    this.closedByUser = true;
    this.settlePendingPublishes();
    this.subs.clear();
    const ws = this.ws;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(guard);
        resolve();
      };
      const guard = unrefTimer(
        setTimeout(() => {
          ws.terminate();
          done();
        }, 1000)
      );
      ws.once("close", done);
      if (ws.readyState === WebSocket.CLOSED) done();
      else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else ws.close(1000, "client shutdown");
    });
    this.handleClose(1000, "client shutdown");
  }
}
