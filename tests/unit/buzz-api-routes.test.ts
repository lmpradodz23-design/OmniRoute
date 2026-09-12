/**
 * /api/buzz routes — HTTP contract against the real DB.
 *
 * - B-L2: GET with the flag off never mints/persists the agent key (agentPubkey null);
 * - B-M2: PUT validates the relay URL (400 with a typed body: { error, code });
 * - B-L5: status never carries embedded credentials;
 * - B-M4: flush against an unreachable relay answers 502 without host:port / raw err.message;
 * - auth precedes everything (401/403 when a password is configured).
 *
 * DB/auth setup mirrors tests/unit/loop-api-routes.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-buzz-api-routes-"));
const ORIGINAL = {
  DATA_DIR: process.env.DATA_DIR,
  API_KEY_SECRET: process.env.API_KEY_SECRET,
  INITIAL_PASSWORD: process.env.INITIAL_PASSWORD,
  BUZZ_HUB_ENABLED: process.env.BUZZ_HUB_ENABLED,
  BUZZ_RELAY_URL: process.env.BUZZ_RELAY_URL,
};
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET ?? "buzz-api-routes-test-secret";
delete process.env.INITIAL_PASSWORD;
delete process.env.BUZZ_HUB_ENABLED;
delete process.env.BUZZ_RELAY_URL;

const core = await import("../../src/lib/db/core.ts");
const buzzRoute = await import("../../src/app/api/buzz/route.ts");
const flushRoute = await import("../../src/app/api/buzz/flush/route.ts");

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

type StatusBody = {
  enabled: boolean;
  relayUrl: string;
  relayConfigured: boolean;
  agentPubkey: string | null;
};
type BuzzErrorBody = { error: string; code: string };

function keyRowExists(): boolean {
  return Boolean(
    core
      .getDbInstance()
      .prepare("SELECT value FROM key_value WHERE namespace = 'buzz' AND key = 'agent_sk'")
      .get()
  );
}

test.beforeEach(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.INITIAL_PASSWORD;
  delete process.env.BUZZ_HUB_ENABLED;
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

test("auth precedes everything: GET/PUT /api/buzz and POST /api/buzz/flush answer 401/403 without credentials", async () => {
  process.env.INITIAL_PASSWORD = "buzz-routes-require-login";
  const responses = await Promise.all([
    buzzRoute.GET(makeRequest("GET", "http://localhost/api/buzz")),
    buzzRoute.PUT(
      makeRequest("PUT", "http://localhost/api/buzz", { relayUrl: "wss://relay.example" })
    ),
    flushRoute.POST(makeRequest("POST", "http://localhost/api/buzz/flush")),
  ]);
  for (const res of responses) {
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  }
});

test("B-L2: GET /api/buzz with the flag off reports agentPubkey null and persists no key", async () => {
  const res = await buzzRoute.GET(makeRequest("GET", "http://localhost/api/buzz"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as StatusBody;
  assert.equal(body.enabled, false);
  assert.equal(body.agentPubkey, null);
  assert.equal(body.relayUrl, "");
  assert.equal(body.relayConfigured, false);
  assert.equal(keyRowExists(), false, "a read must not mint an identity");
});

test("GET /api/buzz with the flag on activates the identity (64-hex pubkey, never the secret)", async () => {
  process.env.BUZZ_HUB_ENABLED = "true";
  const res = await buzzRoute.GET(makeRequest("GET", "http://localhost/api/buzz"));
  const body = (await res.json()) as StatusBody;
  assert.match(body.agentPubkey ?? "", /^[0-9a-f]{64}$/);
  assert.equal(keyRowExists(), true);
  assert.ok(!JSON.stringify(body).includes("agent_sk"));
});

const REJECTED_PUT: Array<[string, string]> = [
  ["ws://user:pass@10.0.0.5", "credentials_in_url"],
  ["ws://169.254.169.254/", "cloud_metadata_host"],
  ["ws://10.0.0.5", "private_host"],
  ["wss://x?y=1", "query_or_fragment"],
  ["ws://relay.example", "tls_required"],
  ["http://relay.example", "unsupported_scheme"],
];

for (const [url, code] of REJECTED_PUT) {
  test(`B-M2: PUT /api/buzz rejects ${url} -> 400 { error, code: ${code} }`, async () => {
    const res = await buzzRoute.PUT(
      makeRequest("PUT", "http://localhost/api/buzz", { relayUrl: url })
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as BuzzErrorBody;
    assert.equal(typeof body.error, "string");
    assert.equal(body.code, code);
    assert.ok(!body.error.includes("pass"), "error never echoes credentials");
    const status = (await (
      await buzzRoute.GET(makeRequest("GET", "http://localhost/api/buzz"))
    ).json()) as StatusBody;
    assert.equal(status.relayUrl, "", "rejected URL is not persisted");
  });
}

for (const url of ["ws://localhost:3000", "ws://127.0.0.1:7777", "wss://relay.example"]) {
  test(`B-M2: PUT /api/buzz accepts ${url}`, async () => {
    const res = await buzzRoute.PUT(
      makeRequest("PUT", "http://localhost/api/buzz", { relayUrl: url })
    );
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text) as StatusBody;
    assert.equal(body.relayUrl, url);
    assert.equal(body.relayConfigured, true);
  });
}

test("PUT /api/buzz with a non-string relayUrl -> 400 typed body; empty string clears the override", async () => {
  const bad = await buzzRoute.PUT(
    makeRequest("PUT", "http://localhost/api/buzz", { relayUrl: 42 })
  );
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as BuzzErrorBody).code, "invalid_body");
  await buzzRoute.PUT(
    makeRequest("PUT", "http://localhost/api/buzz", { relayUrl: "wss://relay.example" })
  );
  const cleared = await buzzRoute.PUT(
    makeRequest("PUT", "http://localhost/api/buzz", { relayUrl: "" })
  );
  assert.equal(cleared.status, 200);
  assert.equal(((await cleared.json()) as StatusBody).relayUrl, "");
});

test("B-L5: status never returns credentials embedded in a persisted relay URL", async () => {
  core
    .getDbInstance()
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'relay_url', ?)"
    )
    .run("wss://user:s3cret@relay.example");
  const res = await buzzRoute.GET(makeRequest("GET", "http://localhost/api/buzz"));
  const text = await res.text();
  assert.ok(!text.includes("s3cret"), "credentials must never reach the client");
});

test("B-M4: flush against an unreachable relay -> 502 with a generic, typed body (no host:port, no raw message)", async () => {
  process.env.BUZZ_HUB_ENABLED = "true";
  process.env.BUZZ_RELAY_URL = "ws://127.0.0.1:1";
  const { enqueueOutbox } = await import("../../src/lib/db/buzzBridge.ts");
  enqueueOutbox({
    event: {
      id: "unreach-" + Math.random().toString(36).slice(2),
      pubkey: "",
      kind: 1,
      createdAt: 1,
      tags: [],
      content: "x",
    },
    correlationId: "c",
  });
  const res = await flushRoute.POST(makeRequest("POST", "http://localhost/api/buzz/flush"));
  assert.equal(res.status, 502);
  const text = await res.text();
  const body = JSON.parse(text) as BuzzErrorBody;
  assert.equal(typeof body.error, "string");
  assert.equal(body.code, "relay_unavailable");
  assert.ok(!text.includes("127.0.0.1"), `hostname leaked: ${text}`);
  assert.ok(!/:1\b/.test(text), `port leaked: ${text}`);
  assert.ok(!/ECONNREFUSED|connect /i.test(text), `raw error leaked: ${text}`);
});

test("flush with the flag on but no relay configured -> 200 skipped (no connection attempt)", async () => {
  process.env.BUZZ_HUB_ENABLED = "true";
  const res = await flushRoute.POST(makeRequest("POST", "http://localhost/api/buzz/flush"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped: boolean; reason?: string };
  assert.equal(body.skipped, true);
  assert.match(body.reason ?? "", /relay/i);
});

test("flush with the flag off -> 200 skipped with the documented reason", async () => {
  const res = await flushRoute.POST(makeRequest("POST", "http://localhost/api/buzz/flush"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    published: 0,
    failed: 0,
    skipped: true,
    reason: "BUZZ_HUB_ENABLED is off",
  });
});
