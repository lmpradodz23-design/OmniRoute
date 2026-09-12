import assert from "node:assert/strict";
import test from "node:test";

import {
  DisabledBuzzAdapter,
  generateSecretKey,
  resolveBuzzAdapter,
  WebSocketBuzzAdapter,
  type OutboxEntry,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

function entry(id: string): OutboxEntry {
  return {
    id,
    correlationId: "c",
    sequenceNumber: 1,
    event: { id, pubkey: "npub_test", kind: 1, createdAt: 1, tags: [], content: "x" },
    status: "pending",
    attempts: 0,
  };
}

test("adapter desabilitado: nao publica, enabled=false", async () => {
  const ad = new DisabledBuzzAdapter();
  assert.equal(ad.enabled, false);
  assert.equal(await ad.publish(entry("e1")), false);
});

test("resolveBuzzAdapter: flag OFF ou sem config -> inerte; flag ON + config -> adaptador real", () => {
  assert.equal(resolveBuzzAdapter(false).enabled, false);
  assert.equal(resolveBuzzAdapter(true).enabled, false); // ainda inerte ate haver relay real
  const real = resolveBuzzAdapter(true, {
    relayUrl: "ws://127.0.0.1:7777",
    secretKeyHex: generateSecretKey(),
  });
  assert.equal(real.enabled, true);
  assert.ok(real instanceof WebSocketBuzzAdapter);
});

test("seguranca: o adaptador real recusa uma URL de relay rejeitada pela validacao (defesa em profundidade)", () => {
  for (const relayUrl of [
    "ws://10.0.0.5:3000",
    "ws://169.254.169.254",
    "ws://user:pw@127.0.0.1:1",
  ]) {
    assert.throws(
      () => new WebSocketBuzzAdapter({ relayUrl, secretKeyHex: generateSecretKey() }),
      /relay URL rejected/
    );
  }
});
