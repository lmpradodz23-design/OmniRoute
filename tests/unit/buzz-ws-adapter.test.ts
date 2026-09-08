import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { WebSocketServer } from "ws";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "@omniroute/open-sse/buzz-bridge/index.ts";
import type { BuzzEvent, OutboxEntry } from "@omniroute/open-sse/buzz-bridge/index.ts";
import { WebSocketBuzzAdapter } from "@omniroute/open-sse/buzz-bridge/wsAdapter.ts";

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function outboxEntry(): OutboxEntry {
  return {
    id: "evt-" + Math.random().toString(36).slice(2),
    correlationId: "c1",
    sequenceNumber: 1,
    event: { id: "ignored", pubkey: "x", kind: 1, createdAt: 1700000000, tags: [], content: "oi" },
    status: "pending",
    attempts: 0,
  };
}

/** Sobe um relay NIP-42 mínimo; `requireAuth` controla se manda o challenge AUTH. */
async function startRelay(requireAuth: boolean) {
  const received: string[] = []; // tipos de mensagem recebidos, em ordem
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, "listening");
  const port = (wss.address() as AddressInfo).port;
  wss.on("connection", (socket) => {
    if (requireAuth) socket.send(JSON.stringify(["AUTH", "challenge-" + port]));
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      received.push(String(msg[0]));
      if (msg[0] === "AUTH") socket.send(JSON.stringify(["OK", msg[1].id, true, ""]));
      if (msg[0] === "EVENT") socket.send(JSON.stringify(["OK", msg[1].id, true, ""]));
    });
  });
  return { url: `ws://127.0.0.1:${port}`, received, close: () => wss.close() };
}

test("wsAdapter: publish só sai APÓS o AUTH NIP-42 (não corre contra o handshake)", async () => {
  const relay = await startRelay(true);
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    authGraceMs: 50,
  });
  try {
    await adapter.connect();
    const ok = await adapter.publish(outboxEntry());
    assert.equal(ok, true, "relay aceitou o EVENT");
    const firstAuth = relay.received.indexOf("AUTH");
    const firstEvent = relay.received.indexOf("EVENT");
    assert.ok(firstAuth >= 0, "o adapter respondeu ao AUTH");
    assert.ok(firstEvent >= 0, "o adapter enviou o EVENT");
    assert.ok(firstAuth < firstEvent, "AUTH foi enviado ANTES do EVENT (sem corrida)");
  } finally {
    await adapter.close();
    relay.close();
  }
});

test("wsAdapter: relay SEM auth_required libera o publish após a janela de graça", async () => {
  const relay = await startRelay(false);
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    authGraceMs: 30,
  });
  try {
    await adapter.connect();
    const ok = await adapter.publish(outboxEntry());
    assert.equal(ok, true, "publica mesmo sem AUTH (relay não exige)");
    assert.deepEqual(relay.received, ["EVENT"], "nenhum AUTH enviado; só o EVENT");
  } finally {
    await adapter.close();
    relay.close();
  }
});

test("wsAdapter: consumidor AUTO-reconecta após queda e volta a receber eventos", async () => {
  // Relay que derruba a 1ª conexão logo após o REQ e, na 2ª (reconexão), envia um EVENT assinado.
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const signed = finalizeEvent(
    { created_at: 1700000001, kind: 1, tags: [], content: "após reconectar" },
    sk
  );
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, "listening");
  const port = (wss.address() as AddressInfo).port;
  let connCount = 0;
  wss.on("connection", (socket) => {
    connCount += 1;
    const myConn = connCount;
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === "REQ") {
        const subId = msg[1];
        if (myConn === 1) {
          socket.close(); // simula queda inesperada da conexão do consumidor
        } else {
          socket.send(JSON.stringify(["EVENT", subId, signed])); // reconectou: entrega o evento
        }
      }
    });
  });

  const received: BuzzEvent[] = [];
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: `ws://127.0.0.1:${port}`,
    secretKeyHex: sk,
    authGraceMs: 20,
    reconnectBaseMs: 20,
    reconnectMaxMs: 100,
  });
  try {
    await adapter.connect();
    await adapter.subscribe({ kinds: [1] }, (ev) => received.push(ev));
    await waitFor(() => received.length > 0); // só passa se auto-reconectou e re-assinou
    assert.ok(connCount >= 2, "houve pelo menos uma reconexão");
    assert.equal(received[0].pubkey, pk, "recebeu o evento entregue após a reconexão");
  } finally {
    await adapter.close();
    wss.close();
  }
});

test("wsAdapter: publish reconecta sob demanda se o socket caiu", async () => {
  const relay = await startRelay(false);
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    authGraceMs: 30,
  });
  try {
    await adapter.connect();
    await adapter.close(); // simula queda: socket fechado entre flushes
    const ok = await adapter.publish(outboxEntry()); // ensureConnected deve reabrir
    assert.equal(ok, true, "reconectou e publicou após o socket ter caído");
  } finally {
    await adapter.close();
    relay.close();
  }
});
