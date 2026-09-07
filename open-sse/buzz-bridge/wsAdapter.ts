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
  private authed = false;
  private readonly timeout: number;
  private readonly pendingOk = new Map<string, (ok: boolean) => void>();
  private readonly subs = new Map<string, (e: BuzzEvent) => void>();

  constructor(private readonly config: WebSocketBuzzConfig) {
    this.pubkey = getPublicKey(config.secretKeyHex);
    this.timeout = config.timeoutMs ?? 8000;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.relayUrl);
      this.ws = ws;
      const openTimer = setTimeout(
        () => reject(new Error("buzz relay connect timeout")),
        this.timeout
      );
      // Resolve pouco depois do open, dando janela para o AUTH (NIP-42) chegar e ser respondido.
      ws.on("open", () => {
        clearTimeout(openTimer);
        setTimeout(() => resolve(), 400);
      });
      ws.on("error", (e: Error) => {
        clearTimeout(openTimer);
        reject(e);
      });
      ws.on("message", (data: WebSocket.RawData) => this.onMessage(data.toString()));
    });
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
      // NIP-42: responde ao challenge com um evento kind 22242 assinado.
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
      this.send(["AUTH", authEvent]);
      this.authed = true;
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
      const cb = this.subs.get(msg[1]);
      const ev = msg[2] as SignedNostrEvent | undefined;
      if (cb && ev && verifyEvent(ev)) cb(toBuzzEvent(ev));
    }
  }

  /** Publica o evento do outbox, assinando-o com a chave deste agente. Retorna true se o relay aceitou. */
  async publish(entry: OutboxEntry): Promise<boolean> {
    const signed = finalizeEvent(
      {
        created_at: entry.event.createdAt || Math.floor(Date.now() / 1000),
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
    const subId = "sub-" + Math.random().toString(36).slice(2, 10);
    this.subs.set(subId, onEvent);
    const f: Record<string, unknown> = {};
    if (filter.kinds) f.kinds = filter.kinds;
    if (filter.since) f.since = filter.since;
    if (filter.channelId) f["#e"] = [filter.channelId];
    this.send(["REQ", subId, f]);
  }

  async close(): Promise<void> {
    this.ws?.close();
  }
}
