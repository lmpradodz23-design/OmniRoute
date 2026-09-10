/**
 * Regression for SSRF finding S-3 (Fase 1): gamification federation servers.
 *
 * `POST /api/gamification/servers` accepted any `z.string().url()` and `syncLeaderboard`,
 * `pushScore` and `healthCheck` in `src/lib/gamification/servers.ts` called plain `fetch` on it:
 * no host validation, redirects followed, and the remote leaderboard body was merged into the
 * local table as-is. An operator-supplied (or tampered) server URL could therefore probe and read
 * internal HTTP services, including cloud metadata.
 *
 * Contract under test:
 *  - `connectServer` validates the URL at write time (scheme, credentials, metadata, private only
 *    under the opt-in) and inserts nothing when it rejects;
 *  - the three network calls go through the hardened client (resolved-address validation,
 *    pinned connection, redirects never followed); a guard decision is terminal and is recorded
 *    with a URL-free error message;
 *  - the remote leaderboard payload is validated: only `{ apiKeyId: string, score: finite number }`
 *    entries are upserted.
 *
 * No real DNS (`lookup` injected); live cases use a loopback server under `allowPrivate: true`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-gamification-ssrf-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core");
const servers = await import("../../src/lib/gamification/servers");
type WebhookLookupFn = import("../../src/shared/network/hardenedWebhookFetch").WebhookLookupFn;

after(() => {
  try {
    core.resetDbInstance();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may still hold a handle at teardown; the OS temp policy reclaims it.
  }
});

function countingLookup(address: string, family: 4 | 6 = 4) {
  let calls = 0;
  const lookup: WebhookLookupFn = async () => {
    calls += 1;
    return [{ address, family }];
  };
  return { lookup, calls: () => calls };
}

function readServerRow(id: string) {
  return core
    .getDbInstance()
    .prepare("SELECT status, error_message FROM community_servers WHERE id = ?")
    .get(id) as { status: string; error_message: string | null } | undefined;
}

function readScores(): Array<{ api_key_id: string; score: number }> {
  return core
    .getDbInstance()
    .prepare("SELECT api_key_id, score FROM leaderboard WHERE scope = 'global' ORDER BY api_key_id")
    .all() as Array<{ api_key_id: string; score: number }>;
}

describe("connectServer — the URL is validated at write time, nothing is inserted on rejection", () => {
  it("rejects cloud-metadata, private (opt-in off), embedded credentials and bad schemes", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "https://metadata.google.internal/",
      "http://10.0.0.5/",
      "http://[fe80::1]/",
      "https://user:pass@federation.example/",
      "ftp://federation.example/",
      "file:///etc/passwd",
    ]) {
      await assert.rejects(
        servers.connectServer("bad", url, "key", { allowPrivate: false }),
        (e: unknown) => e instanceof Error && /block|private|metadata|invalid|scheme|credential/i.test(e.message),
        url
      );
    }
    const rows = core.getDbInstance().prepare("SELECT COUNT(*) AS n FROM community_servers").get() as { n: number };
    assert.equal(rows.n, 0, "a rejected URL must never be persisted");
  });

  it("still rejects metadata even with the private opt-in", async () => {
    await assert.rejects(
      servers.connectServer("meta", "http://169.254.169.254/", "key", { allowPrivate: true }),
      /metadata|block/i
    );
  });

  it("accepts a public https server, and a private one only under the opt-in", async () => {
    const pub = await servers.connectServer("pub", "https://federation.example", "key", { allowPrivate: false });
    assert.equal(pub.url, "https://federation.example");
    const lan = await servers.connectServer("lan", "http://192.168.0.10:8080", "key", { allowPrivate: true });
    assert.equal(lan.status, "connected");
  });
});

describe("syncLeaderboard / pushScore / healthCheck — blocked by the RESOLVED address, no oracle", () => {
  it("syncLeaderboard: public hostname resolving to metadata is blocked (even with opt-in), status=error, URL-free message", async () => {
    const s = await servers.connectServer("meta-sync", "https://federation.example", "key", { allowPrivate: false });
    const { lookup, calls } = countingLookup("169.254.169.254");
    const r = await servers.syncLeaderboard(s.id, { lookup, allowPrivate: true });
    assert.equal(r.synced, 0);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /metadata|block/i);
    assert.equal(calls(), 1, "a blocked target must be resolved once and never retried");
    const row = readServerRow(s.id);
    assert.equal(row?.status, "error");
    assert.ok(row?.error_message && !/federation\.example|169\.254/.test(row.error_message), "no URL/ip in the stored error");
  });

  it("syncLeaderboard: private resolved address is blocked when the opt-in is off", async () => {
    const s = await servers.connectServer("priv-sync", "https://federation.example", "key", { allowPrivate: false });
    const { lookup } = countingLookup("10.1.2.3");
    const r = await servers.syncLeaderboard(s.id, { lookup, allowPrivate: false });
    assert.equal(r.synced, 0);
    assert.match(r.errors[0], /private|block/i);
  });

  it("pushScore: metadata target is blocked before any request", async () => {
    const s = await servers.connectServer("meta-push", "https://federation.example", "key", { allowPrivate: false });
    const { lookup, calls } = countingLookup("169.254.169.254");
    const r = await servers.pushScore(s.id, "k1", 10, { lookup, allowPrivate: true });
    assert.equal(r.success, false);
    assert.match(r.error ?? "", /metadata|block/i);
    assert.equal(calls(), 1);
  });

  it("healthCheck: blocked target reports unhealthy without a request", async () => {
    const s = await servers.connectServer("meta-health", "https://federation.example", "key", { allowPrivate: false });
    const { lookup } = countingLookup("169.254.169.254");
    const r = await servers.healthCheck(s.id, { lookup, allowPrivate: true });
    assert.equal(r.healthy, false);
  });
});

describe("federation over a live loopback server — redirects never followed, payload validated, delivery works", () => {
  let server: Server;
  let base = "";
  let requestCount = 0;
  let mode: "ok" | "redirect" | "malformed" | "partial" = "ok";
  let lastMethod = "";
  let lastPath = "";
  let lastAuth: string | undefined;
  let lastBody = "";

  before(async () => {
    server = createServer((req, res) => {
      requestCount += 1;
      lastMethod = req.method ?? "";
      lastPath = req.url ?? "";
      lastAuth = req.headers.authorization;
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        lastBody = raw;
        if (mode === "redirect") {
          res.writeHead(302, { Location: "http://127.0.0.1:9/internal" });
          res.end();
          return;
        }
        if (mode === "malformed") {
          res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
          res.end(JSON.stringify({ entries: "nope" }));
          return;
        }
        if (mode === "partial") {
          res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
          res.end(
            JSON.stringify({
              entries: [
                { apiKeyId: "k-valid", score: 42 },
                { apiKeyId: 5, score: 1 },
                { apiKeyId: "k-nan", score: "x" },
                { apiKeyId: "k-inf", score: Infinity },
                { apiKeyId: "", score: 3 },
                "garbage",
              ],
            })
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ entries: [{ apiKeyId: "k-a", score: 7 }, { apiKeyId: "k-b", score: 9 }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("syncLeaderboard never follows a redirect (one request) and records a URL-free error", async () => {
    mode = "redirect";
    requestCount = 0;
    const s = await servers.connectServer("redir", base, "key", { allowPrivate: true });
    const r = await servers.syncLeaderboard(s.id, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.synced, 0);
    assert.match(r.errors[0], /redirect/i);
    assert.equal(requestCount, 1, "the redirect hop must NOT be fetched");
    const row = readServerRow(s.id);
    assert.equal(row?.status, "error");
    assert.ok(row?.error_message && !row.error_message.includes("127.0.0.1"), "no URL in the stored error");
  });

  it("syncLeaderboard rejects a malformed payload and upserts nothing", async () => {
    mode = "malformed";
    const s = await servers.connectServer("malformed", base, "key", { allowPrivate: true });
    const before = readScores().length;
    const r = await servers.syncLeaderboard(s.id, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.synced, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(readScores().length, before, "invalid payload must not touch the leaderboard");
  });

  it("syncLeaderboard keeps only well-formed entries", async () => {
    mode = "partial";
    const s = await servers.connectServer("partial", base, "key", { allowPrivate: true });
    const r = await servers.syncLeaderboard(s.id, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.synced, 1);
    assert.deepEqual(r.errors, []);
    const scores = readScores().filter((x) => x.api_key_id === "k-valid");
    assert.deepEqual(scores, [{ api_key_id: "k-valid", score: 42 }]);
    assert.equal(readScores().some((x) => ["k-nan", "k-inf", ""].includes(x.api_key_id)), false);
  });

  it("syncLeaderboard delivers and merges a valid remote leaderboard (functional regression guard)", async () => {
    mode = "ok";
    requestCount = 0;
    const s = await servers.connectServer("ok", base, "key", { allowPrivate: true });
    const r = await servers.syncLeaderboard(s.id, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.synced, 2);
    assert.deepEqual(r.errors, []);
    assert.equal(requestCount, 1);
    assert.equal(lastPath, "/api/gamification/federation/leaderboard");
    assert.ok(lastAuth?.startsWith("Bearer "), "the federation bearer must still be sent");
    const scores = readScores().filter((x) => ["k-a", "k-b"].includes(x.api_key_id));
    assert.deepEqual(scores, [
      { api_key_id: "k-a", score: 7 },
      { api_key_id: "k-b", score: 9 },
    ]);
    const row = readServerRow(s.id);
    assert.equal(row?.status, "connected");
    assert.equal(row?.error_message, null);
  });

  it("pushScore posts JSON with the bearer to the score endpoint", async () => {
    mode = "ok";
    requestCount = 0;
    const s = await servers.connectServer("push", base, "key", { allowPrivate: true });
    const r = await servers.pushScore(s.id, "k-a", 11, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.success, true);
    assert.equal(requestCount, 1);
    assert.equal(lastMethod, "POST");
    assert.equal(lastPath, "/api/gamification/federation/score");
    assert.ok(lastAuth?.startsWith("Bearer "));
    assert.deepEqual(JSON.parse(lastBody), { apiKeyId: "k-a", score: 11 });
  });

  it("healthCheck reports healthy for a reachable server and never follows a redirect", async () => {
    mode = "ok";
    const s = await servers.connectServer("health", base, "key", { allowPrivate: true });
    const ok = await servers.healthCheck(s.id, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(ok.healthy, true);
    mode = "redirect";
    requestCount = 0;
    const redirected = await servers.healthCheck(s.id, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(redirected.healthy, false);
    assert.equal(requestCount, 1);
  });
});
