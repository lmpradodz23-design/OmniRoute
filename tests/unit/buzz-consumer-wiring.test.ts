/**
 * A-H2 — the inbox consumer is wired for real: `initBuzzInboxConsumer` (called from
 * src/instrumentation-node.ts) registers its shutdown hook ALWAYS, connects only with
 * BUZZ_HUB_ENABLED on + a valid relay, persists verified events into `buzz_inbox`, reconnects
 * with backoff when the relay drops, and is closed by `requestGracefulShutdown`.
 *
 * The graceful-shutdown case is last on purpose: it closes the database for this process.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { finalizeEvent, generateSecretKey } from "../../open-sse/buzz-bridge/index.ts";
import { startFakeRelay, type FakeRelay } from "../helpers/buzzFakeRelay.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-buzz-consumer-"));
const ORIGINAL = {
  DATA_DIR: process.env.DATA_DIR,
  BUZZ_HUB_ENABLED: process.env.BUZZ_HUB_ENABLED,
  BUZZ_RELAY_URL: process.env.BUZZ_RELAY_URL,
};
process.env.DATA_DIR = TEST_DATA_DIR;
delete process.env.BUZZ_RELAY_URL;
delete process.env.BUZZ_HUB_ENABLED;

const core = await import("../../src/lib/db/core.ts");
const buzz = await import("../../src/lib/buzzService.ts");
const consumer = await import("../../src/lib/buzzConsumer.ts");
const hooks = await import("../../src/lib/shutdownHooks.ts");
const instrumentationSource = fs.readFileSync(
  path.join(process.cwd(), "src/instrumentation-node.ts"),
  "utf8"
);

function inboxCount(): number {
  return (
    core.getDbInstance().prepare("SELECT COUNT(*) AS n FROM buzz_inbox").get() as { n: number }
  ).n;
}

let relay: FakeRelay | null = null;

test.beforeEach(async () => {
  await consumer.stopBuzzInboxConsumer();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.BUZZ_HUB_ENABLED;
  delete process.env.BUZZ_RELAY_URL;
});

test.afterEach(async () => {
  await consumer.stopBuzzInboxConsumer();
  if (relay) {
    await relay.close();
    relay = null;
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("instrumentation-node boots the consumer through initBuzzInboxConsumer", () => {
  assert.match(instrumentationSource, /buzzConsumer/);
  assert.match(instrumentationSource, /initBuzzInboxConsumer/);
});

test("flag OFF: nothing connects, but the shutdown hook is registered anyway", async () => {
  relay = await startFakeRelay();
  buzz.setBuzzRelayUrl(relay.url);
  assert.equal(consumer.initBuzzInboxConsumer(), false);
  assert.ok(hooks.getShutdownHooks().has("buzz-inbox"), "hook registered regardless of the flag");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(relay.connections(), 0, "no connection with the flag off");
  assert.equal(consumer.isBuzzInboxConsumerRunning(), false);
});

test("flag ON without a configured relay: armed=false, no connection, no crash", () => {
  process.env.BUZZ_HUB_ENABLED = "true";
  assert.equal(consumer.initBuzzInboxConsumer(), false);
  assert.equal(consumer.isBuzzInboxConsumerRunning(), false);
});

test("flag ON + relay: a verified event received on the subscription lands in buzz_inbox (dedup)", async () => {
  relay = await startFakeRelay({ requireAuth: true });
  process.env.BUZZ_HUB_ENABLED = "true";
  buzz.setBuzzRelayUrl(relay.url);
  assert.equal(consumer.initBuzzInboxConsumer({ reconnectBaseMs: 50, reconnectMaxMs: 200 }), true);
  await relay.waitFor(() => relay.subscriptions.length === 1, 5000, "REQ from the consumer");
  const author = generateSecretKey();
  const event = finalizeEvent(
    { created_at: 1, kind: 1, tags: [["t", "buzz"]], content: "hi" },
    author
  );
  relay.broadcastEvent(event);
  await relay.waitFor(() => inboxCount() === 1, 5000, "buzz_inbox row");
  relay.broadcastEvent(event); // redelivery
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(inboxCount(), 1, "dedup by event id");
  assert.equal(buzz.getBuzzStatus().counts.inboxReceived, 1);
  assert.equal(consumer.isBuzzInboxConsumerRunning(), true);
});

test("relay drop: the consumer reconnects with backoff and re-subscribes", async () => {
  relay = await startFakeRelay({ requireAuth: true });
  process.env.BUZZ_HUB_ENABLED = "true";
  buzz.setBuzzRelayUrl(relay.url);
  assert.equal(consumer.initBuzzInboxConsumer({ reconnectBaseMs: 50, reconnectMaxMs: 200 }), true);
  await relay.waitFor(() => relay.subscriptions.length === 1, 5000, "first REQ");
  relay.dropClients();
  await relay.waitFor(() => relay.subscriptions.length === 2, 5000, "second REQ after reconnect");
  assert.equal(relay.connections(), 2);
});

test("unreachable relay at boot: init does not throw and keeps retrying in the background", async () => {
  relay = await startFakeRelay();
  const url = relay.url;
  await relay.close();
  relay = null;
  process.env.BUZZ_HUB_ENABLED = "true";
  buzz.setBuzzRelayUrl(url);
  assert.doesNotThrow(() =>
    consumer.initBuzzInboxConsumer({ reconnectBaseMs: 30, reconnectMaxMs: 100 })
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(consumer.isBuzzInboxConsumerRunning(), false, "not connected yet");
  await consumer.stopBuzzInboxConsumer();
});

test("requestGracefulShutdown closes the consumer's relay connection and stops reconnecting", async () => {
  relay = await startFakeRelay({ requireAuth: true });
  process.env.BUZZ_HUB_ENABLED = "true";
  buzz.setBuzzRelayUrl(relay.url);
  assert.equal(consumer.initBuzzInboxConsumer({ reconnectBaseMs: 30, reconnectMaxMs: 100 }), true);
  await relay.waitFor(() => relay.openClients() === 1, 5000, "consumer connected");
  const { requestGracefulShutdown } = await import("../../src/lib/gracefulShutdown.ts");
  await requestGracefulShutdown("test-signal");
  await relay.waitFor(() => relay.openClients() === 0, 5000, "adapter.close() via shutdown hook");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(relay.connections(), 1, "no reconnect after shutdown");
  assert.equal(consumer.isBuzzInboxConsumerRunning(), false);
});
