import assert from "node:assert/strict";
import test from "node:test";

import {
  buzzIdentityIsMapped,
  DisabledBuzzAdapter,
  Inbox,
  nostrKeyAuthorizes,
  Outbox,
  resolveBuzzAdapter,
  type BuzzEvent,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

function ev(id: string, kind = 1): BuzzEvent {
  return { id, pubkey: "npub_test", kind, createdAt: 1, tags: [], content: "x" };
}

test("outbox: enqueue e idempotente por event.id", () => {
  const ob = new Outbox();
  const a = ob.enqueue({ event: ev("e1"), correlationId: "c1" });
  const a2 = ob.enqueue({ event: ev("e1"), correlationId: "c1" }); // duplicado
  assert.equal(ob.size(), 1);
  assert.equal(a.sequenceNumber, a2.sequenceNumber);
});

test("outbox: pending ordenado por sequence, markPublished/failed/requeue", () => {
  const ob = new Outbox();
  ob.enqueue({ event: ev("e1"), correlationId: "c" });
  ob.enqueue({ event: ev("e2"), correlationId: "c" });
  assert.deepEqual(
    ob.pending().map((e) => e.id),
    ["e1", "e2"]
  );
  ob.markPublished("e1");
  assert.deepEqual(
    ob.pending().map((e) => e.id),
    ["e2"]
  );
  ob.markFailed("e2");
  assert.equal(ob.pending().length, 0);
  ob.requeueFailed();
  assert.deepEqual(
    ob.pending().map((e) => e.id),
    ["e2"]
  );
});

test("inbox: dedup por event.id (processa no maximo uma vez)", () => {
  const ib = new Inbox();
  assert.notEqual(ib.receive(ev("e1"), "c"), null);
  assert.equal(ib.receive(ev("e1"), "c"), null); // ja visto
  assert.equal(ib.seenCount(), 1);
});

test("adapter desabilitado: nao publica, enabled=false", async () => {
  const ad = new DisabledBuzzAdapter();
  assert.equal(ad.enabled, false);
  const ob = new Outbox();
  const entry = ob.enqueue({ event: ev("e1"), correlationId: "c" });
  assert.equal(await ad.publish(entry), false);
});

test("resolveBuzzAdapter: flag OFF -> inerte", () => {
  assert.equal(resolveBuzzAdapter(false).enabled, false);
  assert.equal(resolveBuzzAdapter(true).enabled, false); // ainda inerte ate haver relay real
});

test("seguranca: chave Nostr sozinha NUNCA autoriza", () => {
  assert.equal(nostrKeyAuthorizes(), false);
});

test("seguranca: mapeamento de identidade exige pubkey + tenant/workspace", () => {
  assert.equal(buzzIdentityIsMapped(undefined, "npub_x"), false);
  assert.equal(
    buzzIdentityIsMapped({ tenantId: "t", workspaceId: "w", buzzPubkey: "npub_x" }, "npub_x"),
    true
  );
  // pubkey diferente do mapeado -> false (fail-closed)
  assert.equal(
    buzzIdentityIsMapped({ tenantId: "t", workspaceId: "w", buzzPubkey: "npub_x" }, "npub_y"),
    false
  );
});
