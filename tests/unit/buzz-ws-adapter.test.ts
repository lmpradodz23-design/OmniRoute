/**
 * B-M3 / A-H3 (connect) — WebSocketBuzzAdapter against a real local `ws` relay.
 *
 * - connect() resolves only after the NIP-42 AUTH round-trip (OK for kind 22242) or the auth
 *   grace timeout when the relay never challenges;
 * - inbound frames are capped (maxPayload 1 MiB): a 2 MiB EVENT is discarded (socket closed 1009);
 * - malformed / unexpected-kind / oversized-content events are ignored BEFORE signature checks;
 * - publish() on a non-open socket returns false (never throws);
 * - close() clears timers and settles pending publishes so nothing keeps the process alive.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeEvent,
  generateSecretKey,
  isWellFormedRelayEvent,
  MAX_EVENT_CONTENT_BYTES,
  WebSocketBuzzAdapter,
  type BuzzEvent,
  type OutboxEntry,
} from "../../open-sse/buzz-bridge/index.ts";
import { startFakeRelay } from "../helpers/buzzFakeRelay.ts";

function entry(id: string, content = "hello"): OutboxEntry {
  return {
    id,
    correlationId: "c",
    sequenceNumber: 1,
    event: { id, pubkey: "", kind: 1, createdAt: 1_700_000_000, tags: [["t", "x"]], content },
    status: "pending",
    attempts: 0,
  };
}

test("connect() resolves only after the AUTH OK — publish right after connect succeeds on an auth-required relay", async () => {
  const relay = await startFakeRelay({ requireAuth: true });
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    timeoutMs: 3000,
  });
  try {
    await adapter.connect();
    assert.equal(relay.lastClientAuthenticated(), true, "AUTH completed before connect resolved");
    assert.equal(adapter.authenticated, true);
    assert.equal(await adapter.publish(entry("e1")), true);
  } finally {
    await adapter.close();
    await relay.close();
  }
});

test("connect() on a relay that never challenges resolves after the auth grace window, not a fixed 400 ms", async () => {
  const relay = await startFakeRelay();
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    timeoutMs: 3000,
    authTimeoutMs: 150,
  });
  try {
    const started = Date.now();
    await adapter.connect();
    assert.ok(Date.now() - started >= 140, "waited the configured grace window");
    assert.equal(adapter.authenticated, false);
    assert.equal(await adapter.publish(entry("e2")), true);
  } finally {
    await adapter.close();
    await relay.close();
  }
});

test("connect() rejects when the relay is unreachable (no unhandled rejection, no open handles)", async () => {
  const relay = await startFakeRelay();
  const url = relay.url;
  await relay.close();
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: url,
    secretKeyHex: generateSecretKey(),
    timeoutMs: 2000,
  });
  await assert.rejects(adapter.connect());
  assert.equal(
    await adapter.publish(entry("e3")),
    false,
    "publish on a closed socket is false, not a throw"
  );
  await adapter.close();
});

test("a 2 MiB frame is discarded: the client errors with WS_ERR_UNSUPPORTED_MESSAGE_LENGTH, sends 1009 to the relay, and no event reaches the callback", async () => {
  const relay = await startFakeRelay();
  const closes: Array<{ code: number; reason: string }> = [];
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    timeoutMs: 3000,
    authTimeoutMs: 50,
    onClose: (info) => closes.push(info),
  });
  const delivered: BuzzEvent[] = [];
  try {
    await adapter.connect();
    await adapter.subscribe({ kinds: [1] }, (e) => delivered.push(e));
    await relay.waitFor(() => relay.subscriptions.length === 1, 3000, "REQ");
    const sub = relay.subscriptions[0];
    const big = finalizeEvent(
      { created_at: 1, kind: 1, tags: [], content: "x".repeat(2 * 1024 * 1024) },
      generateSecretKey()
    );
    relay.sendRawToAll(JSON.stringify(["EVENT", sub.subId, big]));
    await relay.waitFor(() => closes.length === 1, 5000, "client close after oversized frame");
    assert.equal(
      closes[0].reason,
      "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",
      "the maxPayload guard (not a parse error) tore the connection down"
    );
    await relay.waitFor(() => relay.peerCloseCodes.length === 1, 5000, "relay-side close");
    assert.equal(relay.peerCloseCodes[0], 1009, "the relay receives 1009 (message too big)");
    assert.equal(delivered.length, 0);
    assert.equal(adapter.isOpen(), false);
  } finally {
    await adapter.close();
    await relay.close();
  }
});

test("malformed / unexpected events are ignored before signature verification; a valid one is delivered", async () => {
  const relay = await startFakeRelay();
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    timeoutMs: 3000,
    authTimeoutMs: 50,
  });
  const delivered: BuzzEvent[] = [];
  try {
    await adapter.connect();
    await adapter.subscribe({ kinds: [1] }, (e) => delivered.push(e));
    await relay.waitFor(() => relay.subscriptions.length === 1, 3000, "REQ");
    const sub = relay.subscriptions[0];
    const author = generateSecretKey();
    const wrongKind = finalizeEvent(
      { created_at: 1, kind: 7, tags: [], content: "kind 7" },
      author
    );
    const tooLong = finalizeEvent(
      { created_at: 1, kind: 1, tags: [], content: "y".repeat(MAX_EVENT_CONTENT_BYTES + 1) },
      author
    );
    const good = finalizeEvent(
      { created_at: 1, kind: 1, tags: [["t", "ok"]], content: "fine" },
      author
    );
    const tampered = { ...good, content: "tampered" };
    const frames: unknown[] = [
      ["EVENT", sub.subId, { kind: "x" }],
      ["EVENT", sub.subId, null],
      ["EVENT", sub.subId, { ...good, tags: "not-an-array" }],
      ["EVENT", sub.subId, wrongKind],
      ["EVENT", sub.subId, tooLong],
      ["EVENT", sub.subId, tampered],
      ["EVENT", "unknown-sub", good],
      "not json at all",
      ["EVENT", sub.subId, good],
    ];
    for (const f of frames) relay.sendRawToAll(typeof f === "string" ? f : JSON.stringify(f));
    await relay.waitFor(() => delivered.length >= 1, 3000, "valid event delivery");
    assert.equal(
      delivered.length,
      1,
      "only the well-formed, verified, expected-kind event arrives"
    );
    assert.equal(delivered[0].id, good.id);
    assert.equal(adapter.isOpen(), true, "malformed input does not kill the connection");
  } finally {
    await adapter.close();
    await relay.close();
  }
});

test("isWellFormedRelayEvent: shape checks are pure and bounded", () => {
  const sk = generateSecretKey();
  const good = finalizeEvent({ created_at: 1, kind: 1, tags: [["t", "x"]], content: "c" }, sk);
  assert.equal(isWellFormedRelayEvent(good, [1]), true);
  assert.equal(isWellFormedRelayEvent(good, [2]), false, "kind outside the subscription filter");
  assert.equal(isWellFormedRelayEvent(good), true, "no kind filter = any integer kind");
  assert.equal(isWellFormedRelayEvent({ ...good, id: "zz" }, [1]), false);
  assert.equal(isWellFormedRelayEvent({ ...good, sig: 42 }, [1]), false);
  assert.equal(isWellFormedRelayEvent({ ...good, created_at: 1.5 }, [1]), false);
  assert.equal(isWellFormedRelayEvent({ ...good, tags: [["a", 1]] }, [1]), false);
  assert.equal(
    isWellFormedRelayEvent({ ...good, tags: new Array(1000).fill(["t", "x"]) }, [1]),
    false
  );
  assert.equal(
    isWellFormedRelayEvent({ ...good, content: "x".repeat(MAX_EVENT_CONTENT_BYTES) }, [1]),
    true
  );
  assert.equal(
    isWellFormedRelayEvent({ ...good, content: "x".repeat(MAX_EVENT_CONTENT_BYTES + 1) }, [1]),
    false
  );
});

test("close() settles a pending publish with false and leaves no timers behind", async () => {
  const relay = await startFakeRelay({ silent: true });
  const adapter = new WebSocketBuzzAdapter({
    relayUrl: relay.url,
    secretKeyHex: generateSecretKey(),
    timeoutMs: 60_000, // a leaked timer this long would hang the process if not cleared
    authTimeoutMs: 50,
  });
  try {
    await adapter.connect();
    const pending = adapter.publish(entry("e4"));
    await relay.waitFor(
      () => relay.received.some((m) => Array.isArray(m) && m[0] === "EVENT"),
      3000,
      "EVENT"
    );
    const started = Date.now();
    await adapter.close();
    assert.equal(await pending, false, "pending publish resolves false on close");
    assert.ok(Date.now() - started < 1000, "close settles promptly, not after the publish timeout");
    assert.equal(adapter.isOpen(), false);
  } finally {
    await relay.close();
  }
});
