import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { BuzzEvent } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { getDbInstance } from "@/lib/db/core";
import { enqueueOutbox, markOutbox, pendingOutbox, receiveInbox } from "@/lib/db/buzzBridge";

function ensureSchema(): void {
  const sql = readFileSync(
    join(process.cwd(), "src/lib/db/migrations/175_loop_engine_and_buzz_bridge.sql"),
    "utf8"
  );
  getDbInstance().exec(sql);
}

function ev(id: string): BuzzEvent {
  return { id, pubkey: "npub_t", kind: 1, createdAt: 1, tags: [], content: "c" };
}

test("buzz repo: enqueue idempotente + pending + markPublished", () => {
  ensureSchema();
  const id = "evt-" + Math.random().toString(36).slice(2);
  const a = enqueueOutbox({ event: ev(id), correlationId: "c1" });
  const a2 = enqueueOutbox({ event: ev(id), correlationId: "c1" }); // duplicado -> mesma seq
  assert.equal(a.sequenceNumber, a2.sequenceNumber);
  assert.ok(pendingOutbox().some((e) => e.id === id));
  markOutbox(id, "published");
  assert.equal(
    pendingOutbox().some((e) => e.id === id),
    false
  );
});

test("buzz repo: enqueue carimba createdAt (estavel) quando ausente -> publish idempotente", () => {
  ensureSchema();
  const id = "evt0-" + Math.random().toString(36).slice(2);
  // Evento sem createdAt (0): o enqueue deve carimbar um timestamp estavel e persisti-lo,
  // para a publicacao re-assinar sempre com o MESMO id (dedup real do relay).
  const raw: BuzzEvent = { id, pubkey: "npub_t", kind: 1, createdAt: 0, tags: [], content: "c" };
  enqueueOutbox({ event: raw, correlationId: "c1" });
  const stamped = pendingOutbox().find((e) => e.id === id);
  assert.ok(stamped, "entrada deve existir no outbox");
  assert.ok(stamped!.event.createdAt > 0, "createdAt deve ser carimbado (>0)");
  const first = stamped!.event.createdAt;
  // Re-enqueue idempotente NAO deve mudar o createdAt persistido.
  enqueueOutbox({ event: { ...raw, createdAt: 999 }, correlationId: "c1" });
  const again = pendingOutbox().find((e) => e.id === id);
  assert.equal(again!.event.createdAt, first, "createdAt persiste estavel entre re-enqueues");
});

test("buzz repo: receiveInbox deduplica (processa no maximo uma vez)", () => {
  ensureSchema();
  const id = "in-" + Math.random().toString(36).slice(2);
  assert.notEqual(receiveInbox(ev(id), "c"), null);
  assert.equal(receiveInbox(ev(id), "c"), null); // ja visto
});
