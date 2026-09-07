import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

test("nostr: gera chave, deriva pubkey (32 bytes hex)", () => {
  const sk = generateSecretKey();
  assert.equal(sk.length, 64); // 32 bytes hex
  const pk = getPublicKey(sk);
  assert.equal(pk.length, 64); // x-only 32 bytes hex
});

test("nostr: finalizeEvent produz id+sig validos e verifyEvent aprova", () => {
  const sk = generateSecretKey();
  const ev = finalizeEvent(
    { created_at: 1_700_000_000, kind: 1, tags: [["t", "buzz"]], content: "olá agentes" },
    sk
  );
  assert.equal(ev.id.length, 64);
  assert.equal(ev.sig.length, 128); // 64 bytes hex
  assert.equal(ev.pubkey, getPublicKey(sk));
  assert.equal(verifyEvent(ev), true);
});

test("nostr: evento adulterado falha na verificacao (fail-closed)", () => {
  const sk = generateSecretKey();
  const ev = finalizeEvent({ created_at: 1, kind: 1, tags: [], content: "original" }, sk);
  const tampered = { ...ev, content: "adulterado" };
  assert.equal(verifyEvent(tampered), false);
});
