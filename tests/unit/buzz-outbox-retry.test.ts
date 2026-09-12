/**
 * A-H3 — outbox retry with exponential backoff + jitter, bounded attempts, and the flush
 * deadline; end to end against a fake relay (auth-required, reject-all, silent).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BuzzEvent } from "../../open-sse/buzz-bridge/index.ts";
import { startFakeRelay } from "../helpers/buzzFakeRelay.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-buzz-retry-"));
const ORIGINAL = {
  DATA_DIR: process.env.DATA_DIR,
  BUZZ_HUB_ENABLED: process.env.BUZZ_HUB_ENABLED,
  BUZZ_RELAY_URL: process.env.BUZZ_RELAY_URL,
};
process.env.DATA_DIR = TEST_DATA_DIR;
delete process.env.BUZZ_RELAY_URL;

const core = await import("../../src/lib/db/core.ts");
const repo = await import("../../src/lib/db/buzzBridge.ts");
const buzz = await import("../../src/lib/buzzService.ts");

function ev(id: string): BuzzEvent {
  return { id, pubkey: "", kind: 1, createdAt: 1_700_000_000, tags: [["t", "loop"]], content: id };
}

function attemptsOf(id: string): {
  status: string;
  attempts: number;
  next_attempt_at: string | null;
} {
  return core
    .getDbInstance()
    .prepare("SELECT status, attempts, next_attempt_at FROM buzz_outbox WHERE id = ?")
    .get(id) as { status: string; attempts: number; next_attempt_at: string | null };
}

test.beforeEach(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  process.env.BUZZ_HUB_ENABLED = "true";
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("outboxRetryDelayMs: exponential with jitter, capped", () => {
  const lo = (n: number) => repo.outboxRetryDelayMs(n, () => 0);
  const hi = (n: number) => repo.outboxRetryDelayMs(n, () => 0.999999);
  assert.ok(lo(1) < hi(1), "jitter widens the window");
  assert.ok(lo(2) >= lo(1) * 1.5, "attempt 2 waits longer than attempt 1");
  assert.ok(lo(3) >= lo(2) * 1.5);
  assert.ok(hi(50) <= repo.OUTBOX_RETRY_MAX_MS, "capped");
  assert.ok(lo(1) >= repo.OUTBOX_RETRY_BASE_MS * 0.5);
  assert.equal(repo.OUTBOX_MAX_ATTEMPTS, 5);
});

test("repo: a failed entry is retried after its backoff, and never after OUTBOX_MAX_ATTEMPTS", () => {
  const id = "retry-" + Math.random().toString(36).slice(2);
  repo.enqueueOutbox({ event: ev(id), correlationId: "c" });
  const t0 = Date.parse("2026-09-12T12:00:00.000Z");
  repo.markOutbox(id, "failed", t0);
  const row = attemptsOf(id);
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.ok(
    row.next_attempt_at && Date.parse(row.next_attempt_at) > t0,
    "next attempt is scheduled"
  );
  assert.equal(
    repo.pendingOutbox(100, undefined, t0).some((e) => e.id === id),
    false,
    "not before backoff"
  );
  const later = t0 + repo.OUTBOX_RETRY_MAX_MS + 1;
  assert.equal(
    repo.pendingOutbox(100, undefined, later).some((e) => e.id === id),
    true,
    "retried after backoff"
  );
  for (let i = 1; i < repo.OUTBOX_MAX_ATTEMPTS; i++) repo.markOutbox(id, "failed", t0);
  assert.equal(attemptsOf(id).attempts, repo.OUTBOX_MAX_ATTEMPTS);
  const farFuture = t0 + 365 * 24 * 3600 * 1000;
  assert.equal(
    repo.pendingOutbox(100, undefined, farFuture).some((e) => e.id === id),
    false,
    "terminal after max attempts"
  );
  assert.equal(attemptsOf(id).status, "failed");
});

test("repo: legacy failed rows (no next_attempt_at) are retried immediately", () => {
  const id = "legacy-" + Math.random().toString(36).slice(2);
  repo.enqueueOutbox({ event: ev(id), correlationId: "c" });
  core
    .getDbInstance()
    .prepare("UPDATE buzz_outbox SET status='failed', attempts=1, next_attempt_at=NULL WHERE id=?")
    .run(id);
  assert.ok(repo.pendingOutbox(100).some((e) => e.id === id));
});

test("flush publishes on an auth-required relay (NIP-42 completes before the first EVENT)", async () => {
  const relay = await startFakeRelay({ requireAuth: true });
  try {
    buzz.setBuzzRelayUrl(relay.url);
    const id = "auth-" + Math.random().toString(36).slice(2);
    repo.enqueueOutbox({ event: ev(id), correlationId: "c" });
    const res = await buzz.flushBuzzOutbox();
    assert.deepEqual(
      { published: res.published, failed: res.failed, skipped: res.skipped },
      { published: 1, failed: 0, skipped: false }
    );
    assert.equal(attemptsOf(id).status, "published");
    const authFrame = relay.received.findIndex((m) => Array.isArray(m) && m[0] === "AUTH");
    const eventFrame = relay.received.findIndex((m) => Array.isArray(m) && m[0] === "EVENT");
    assert.ok(authFrame >= 0 && eventFrame > authFrame, "AUTH was sent before the EVENT");
  } finally {
    await relay.close();
  }
});

test("flush: a rejected entry becomes failed, is retried on a later flush, and stops after max attempts", async () => {
  // AUTH is answered immediately (no grace-window wait); every EVENT is then rejected.
  const relay = await startFakeRelay({ requireAuth: true, rejectAll: true });
  try {
    buzz.setBuzzRelayUrl(relay.url);
    const id = "rej-" + Math.random().toString(36).slice(2);
    repo.enqueueOutbox({ event: ev(id), correlationId: "c" });
    let now = Date.parse("2026-09-12T12:00:00.000Z");
    const first = await buzz.flushBuzzOutbox({ now });
    assert.equal(first.failed, 1);
    assert.equal(attemptsOf(id).attempts, 1);

    const tooSoon = await buzz.flushBuzzOutbox({ now: now + 1000 });
    assert.equal(
      tooSoon.failed + tooSoon.published,
      0,
      "inside the backoff window nothing is retried"
    );
    assert.equal(attemptsOf(id).attempts, 1);

    for (let expected = 2; expected <= repo.OUTBOX_MAX_ATTEMPTS; expected++) {
      now += repo.OUTBOX_RETRY_MAX_MS + 1;
      const again = await buzz.flushBuzzOutbox({ now });
      assert.equal(again.failed, 1, `attempt ${expected} was retried`);
      assert.equal(attemptsOf(id).attempts, expected);
    }
    now += repo.OUTBOX_RETRY_MAX_MS + 1;
    const dead = await buzz.flushBuzzOutbox({ now });
    assert.equal(dead.failed + dead.published, 0, "terminal: no more attempts");
    assert.equal(attemptsOf(id).attempts, repo.OUTBOX_MAX_ATTEMPTS);
    assert.equal(buzz.getBuzzStatus().counts.outboxFailed, 1);
  } finally {
    await relay.close();
  }
});

test("flush has a total deadline: a stalled relay cannot hold the request for limit x timeout", async () => {
  // AUTH completes instantly, so the whole budget is spent on the stalled publishes.
  const relay = await startFakeRelay({ requireAuth: true, silent: true });
  try {
    buzz.setBuzzRelayUrl(relay.url);
    for (let i = 0; i < 3; i++)
      repo.enqueueOutbox({
        event: ev(`stall-${i}-${Math.random().toString(36).slice(2)}`),
        correlationId: "c",
      });
    const started = Date.now();
    const res = await buzz.flushBuzzOutbox({ deadlineMs: 400 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `flush returned within the deadline (took ${elapsed} ms)`);
    assert.equal(res.deadlineReached, true);
    assert.equal(res.published, 0);
    assert.ok(
      res.failed >= 1 && res.failed < 3,
      `only the entries attempted before the deadline fail (${res.failed})`
    );
    assert.ok(
      buzz.getBuzzStatus().counts.outboxPending >= 1,
      "the rest stays pending for the next flush"
    );
  } finally {
    await relay.close();
  }
});

test("flush is skipped (no connection attempt) when no relay is configured", async () => {
  delete process.env.BUZZ_RELAY_URL;
  repo.enqueueOutbox({
    event: ev("norelay-" + Math.random().toString(36).slice(2)),
    correlationId: "c",
  });
  const res = await buzz.flushBuzzOutbox();
  assert.equal(res.skipped, true);
  assert.equal(res.published, 0);
});
