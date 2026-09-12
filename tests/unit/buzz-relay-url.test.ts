/**
 * B-M2 / B-L5 / B-L3 — relay URL contract.
 *
 * `validateBuzzRelayUrl` is the single gate for every relay URL source (panel PUT, env
 * BUZZ_RELAY_URL, persisted override): parsed with `new URL`, no userinfo/query/fragment,
 * cloud-metadata hosts always blocked, private hosts blocked except loopback, TLS (wss://)
 * mandatory beyond loopback. The default relay URL is EMPTY (disabled until configured).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-buzz-relay-url-"));
const ORIGINAL = {
  DATA_DIR: process.env.DATA_DIR,
  BUZZ_RELAY_URL: process.env.BUZZ_RELAY_URL,
};
process.env.DATA_DIR = TEST_DATA_DIR;
delete process.env.BUZZ_RELAY_URL;

const core = await import("../../src/lib/db/core.ts");
const bridge = await import("../../open-sse/buzz-bridge/index.ts");
const buzz = await import("../../src/lib/buzzService.ts");

test.beforeEach(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.BUZZ_RELAY_URL;
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const REJECTED: Array<[string, string]> = [
  ["ws://user:pass@10.0.0.5", "credentials_in_url"],
  ["ws://user:pass@127.0.0.1:7777", "credentials_in_url"],
  ["ws://169.254.169.254/", "cloud_metadata_host"],
  ["wss://169.254.169.254/", "cloud_metadata_host"],
  ["wss://[fd00:ec2::254]/", "cloud_metadata_host"],
  ["wss://metadata.google.internal/", "cloud_metadata_host"],
  ["ws://10.0.0.5", "private_host"],
  ["wss://10.0.0.5", "private_host"],
  ["wss://192.168.1.10:7777", "private_host"],
  ["ws://0.0.0.0:3000", "private_host"],
  ["wss://x?y=1", "query_or_fragment"],
  ["wss://relay.example/#frag", "query_or_fragment"],
  ["ws://relay.example", "tls_required"],
  ["http://relay.example", "unsupported_scheme"],
  ["https://relay.example", "unsupported_scheme"],
  ["not a url", "invalid_url"],
  ["", "invalid_url"],
];

for (const [input, code] of REJECTED) {
  test(`validateBuzzRelayUrl rejects ${JSON.stringify(input)} with ${code}`, () => {
    const res = bridge.validateBuzzRelayUrl(input);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, code);
    assert.equal(typeof res.message, "string");
    assert.ok(!res.message.includes("pass"), "message never echoes credentials");
  });
}

const ACCEPTED = [
  "ws://localhost:3000",
  "ws://127.0.0.1:7777",
  "ws://[::1]:7777",
  "wss://localhost:3000",
  "wss://relay.example",
  "wss://relay.example:7000/path",
];

for (const input of ACCEPTED) {
  test(`validateBuzzRelayUrl accepts ${input}`, () => {
    const res = bridge.validateBuzzRelayUrl(input);
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}

test("B-L3: default relay URL is empty (disabled until configured) — no localhost:3000 collision", () => {
  assert.equal(buzz.DEFAULT_BUZZ_RELAY_URL, "");
  assert.equal(buzz.getBuzzRelayUrl(), "");
  assert.equal(buzz.getBuzzStatus().relayUrl, "");
  assert.equal(buzz.getBuzzStatus().relayConfigured, false);
});

test("env BUZZ_RELAY_URL is honoured when valid and ignored (disabled) when it fails the guard", () => {
  process.env.BUZZ_RELAY_URL = "wss://relay.example:7000";
  assert.equal(buzz.getBuzzRelayUrl(), "wss://relay.example:7000");
  process.env.BUZZ_RELAY_URL = "ws://10.0.0.5:3000";
  assert.equal(buzz.getBuzzRelayUrl(), "", "private non-loopback env value is not used");
  process.env.BUZZ_RELAY_URL = "ws://169.254.169.254";
  assert.equal(buzz.getBuzzRelayUrl(), "", "metadata env value is never used");
});

test("setBuzzRelayUrl validates (throws on invalid) and never persists a rejected URL", () => {
  assert.throws(() => buzz.setBuzzRelayUrl("ws://user:pass@10.0.0.5"), /relay/i);
  assert.equal(buzz.getBuzzRelayUrl(), "");
  assert.equal(buzz.setBuzzRelayUrl("ws://127.0.0.1:7777"), "ws://127.0.0.1:7777");
  assert.equal(buzz.setBuzzRelayUrl(""), "", "empty clears the override");
});

test("B-L5: a persisted override carrying credentials is never returned by status (defense in depth)", () => {
  core
    .getDbInstance()
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'relay_url', ?)"
    )
    .run("ws://user:s3cret@127.0.0.1:7777");
  const status = buzz.getBuzzStatus();
  assert.ok(!status.relayUrl.includes("s3cret"), "status must not leak embedded credentials");
  assert.equal(status.relayUrl, "");
  assert.equal(buzz.getBuzzConfig().relayUrl, "");
});
