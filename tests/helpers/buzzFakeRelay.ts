/**
 * Fake Nostr relay for the Buzz bridge tests (NIP-01 + NIP-42 subset), backed by a real
 * `ws` server on 127.0.0.1. Deterministic and inspectable: every parsed frame is recorded,
 * subscriptions are exposed, and behaviour (auth-required, reject-all, silent) is configurable
 * so tests can drive the adapter/consumer through real socket semantics (maxPayload close
 * codes, reconnects, AUTH ordering) without a live buzz-relay.
 */
import { WebSocketServer, type WebSocket } from "ws";

import { verifyEvent, type SignedNostrEvent } from "../../open-sse/buzz-bridge/nostr.ts";

export interface FakeRelayOptions {
  /** Send an AUTH challenge on connect and reject EVENTs until the client authenticates. */
  requireAuth?: boolean;
  /** When false, the AUTH event is always answered `OK false` (client never authenticates). */
  acceptAuth?: boolean;
  /** Answer every EVENT with `OK false` regardless of auth. */
  rejectAll?: boolean;
  /** Never answer EVENTs (simulates a stalled relay). */
  silent?: boolean;
}

export interface FakeRelaySubscription {
  ws: WebSocket;
  subId: string;
  filter: Record<string, unknown>;
}

export interface FakeRelay {
  url: string;
  port: number;
  /** Every parsed inbound frame, in arrival order. */
  received: unknown[];
  subscriptions: FakeRelaySubscription[];
  /** Number of client sockets currently open. */
  openClients(): number;
  /** Whether the (single) most recent client completed NIP-42 auth. */
  lastClientAuthenticated(): boolean;
  /** Total connections accepted since start. */
  connections(): number;
  /** Close codes observed on the SERVER side (what the client sent in its close frame). */
  peerCloseCodes: number[];
  waitFor(predicate: () => boolean, timeoutMs?: number, label?: string): Promise<void>;
  /** Send a raw string frame to every open client (bypasses JSON so oversized frames are possible). */
  sendRawToAll(data: string): void;
  /** Deliver an EVENT to every subscription. */
  broadcastEvent(event: SignedNostrEvent): void;
  /** Server-side drop of every client (simulates a relay restart). */
  dropClients(): void;
  close(): Promise<void>;
}

export async function startFakeRelay(opts: FakeRelayOptions = {}): Promise<FakeRelay> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 4 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });
  const address = wss.address();
  if (!address || typeof address === "string") throw new Error("fake relay: no port");
  const port = address.port;

  const received: unknown[] = [];
  const subscriptions: FakeRelaySubscription[] = [];
  const peerCloseCodes: number[] = [];
  const authed = new WeakMap<WebSocket, boolean>();
  const challenges = new WeakMap<WebSocket, string>();
  let lastClient: WebSocket | null = null;
  let connections = 0;

  const send = (ws: WebSocket, msg: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  wss.on("connection", (ws) => {
    connections += 1;
    lastClient = ws;
    authed.set(ws, false);
    ws.on("close", (code) => peerCloseCodes.push(code));
    if (opts.requireAuth) {
      const challenge = `chal-${connections}-${Math.random().toString(36).slice(2)}`;
      challenges.set(ws, challenge);
      send(ws, ["AUTH", challenge]);
    }
    ws.on("message", (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      received.push(msg);
      if (!Array.isArray(msg)) return;
      const [type, a, b] = msg as [string, unknown, unknown];
      if (type === "AUTH" && a && typeof a === "object") {
        const ev = a as SignedNostrEvent;
        const ok =
          opts.acceptAuth !== false &&
          ev.kind === 22242 &&
          verifyEvent(ev) &&
          ev.tags.some((t) => t[0] === "challenge" && t[1] === challenges.get(ws));
        if (ok) authed.set(ws, true);
        send(ws, ["OK", ev.id, ok, ok ? "" : "auth-required: invalid auth"]);
        return;
      }
      if (type === "EVENT" && a && typeof a === "object") {
        const ev = a as SignedNostrEvent;
        if (opts.silent) return;
        if (opts.rejectAll) {
          send(ws, ["OK", ev.id, false, "blocked: rejected by test relay"]);
          return;
        }
        if (opts.requireAuth && !authed.get(ws)) {
          send(ws, [
            "OK",
            ev.id,
            false,
            "auth-required: we only accept events from authenticated users",
          ]);
          return;
        }
        send(ws, ["OK", ev.id, verifyEvent(ev), ""]);
        return;
      }
      if (type === "REQ" && typeof a === "string") {
        subscriptions.push({ ws, subId: a, filter: (b as Record<string, unknown>) ?? {} });
        send(ws, ["EOSE", a]);
      }
    });
  });

  const openSockets = (): WebSocket[] => [...wss.clients].filter((c) => c.readyState === c.OPEN);

  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    received,
    subscriptions,
    peerCloseCodes,
    openClients: () => openSockets().length,
    lastClientAuthenticated: () => (lastClient ? authed.get(lastClient) === true : false),
    connections: () => connections,
    waitFor(predicate, timeoutMs = 5000, label = "condition") {
      const started = Date.now();
      return new Promise<void>((resolve, reject) => {
        const tick = (): void => {
          if (predicate()) return resolve();
          if (Date.now() - started > timeoutMs) {
            return reject(new Error(`fake relay: timed out waiting for ${label}`));
          }
          setTimeout(tick, 10);
        };
        tick();
      });
    },
    sendRawToAll(data) {
      for (const ws of openSockets()) ws.send(data);
    },
    broadcastEvent(event) {
      for (const sub of subscriptions) send(sub.ws, ["EVENT", sub.subId, event]);
    },
    dropClients() {
      for (const ws of wss.clients) ws.terminate();
    },
    close() {
      for (const ws of wss.clients) ws.terminate();
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
