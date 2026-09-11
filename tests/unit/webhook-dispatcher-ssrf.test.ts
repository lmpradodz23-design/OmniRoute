/**
 * Regression for SSRF finding S-1 (Fase 1 §2.1): the PRODUCTION webhook dispatcher.
 *
 * Finding #1 hardened only the `/api/webhooks/[id]/test` diagnostic route. The path that
 * actually fires on every event — `deliverRaw` (Slack/Discord/Telegram) and `deliverWebhook`
 * (custom, HMAC, 4 attempts) in `src/lib/webhookDispatcher.ts` — still classified the URL by
 * its hostname STRING (no DNS resolution → DNS rebinding) and called plain `fetch` with the
 * default `redirect: "follow"` (a public host could 302 to 169.254.169.254). It also retried
 * blocked targets and surfaced `res.status`, turning the delivery log into a blind-SSRF oracle.
 *
 * The dispatcher must now go through `hardenedWebhookFetch` (resolve + validate every address,
 * pin the connection, never follow redirects, never expose a private body) and must treat a
 * guard block as terminal (no retry, status 0).
 *
 * No real DNS: `lookup` is injected. No real network for the blocked cases: the guard rejects
 * before connecting. The redirect/happy-path cases use a live loopback server under
 * `allowPrivate: true`, exactly like tests/unit/api/webhooks/webhook-test-ssrf-rebinding.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// The dispatcher only reaches the DB through lazy imports inside dispatchEvent (not exercised
// here), but isolate DATA_DIR anyway so a module-load side effect can never touch a real store.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-webhook-ssrf-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { deliverRaw, deliverWebhook } = await import("../../src/lib/webhookDispatcher");
type WebhookLookupFn = import("../../src/shared/network/hardenedWebhookFetch").WebhookLookupFn;

after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can still hold a handle on the temp dir at teardown (EPERM); the OS temp policy
    // reclaims it. Cleanup is best-effort and must never mask the assertions above.
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

const payload = {
  event: "test.ping" as const,
  timestamp: "2026-09-09T00:00:00.000Z",
  data: { hello: "world" },
};

describe("deliverRaw — DNS rebinding is classified by the RESOLVED address", () => {
  it("blocks a public hostname that resolves to cloud metadata, even with the private opt-in", async () => {
    const { lookup, calls } = countingLookup("169.254.169.254");
    const r = await deliverRaw(
      "https://hook.example.test/x",
      { a: 1 },
      { lookup, allowPrivate: true }
    );
    assert.equal(r.success, false);
    assert.equal(r.status, 0, "a blocked target must not leak the internal service's status");
    assert.match(r.error ?? "", /metadata|block/i);
    assert.equal(calls(), 1);
  });

  it("blocks a public hostname that resolves to a private ip when opt-in is OFF", async () => {
    const { lookup } = countingLookup("10.1.2.3");
    const r = await deliverRaw(
      "https://hook.example.test/x",
      { a: 1 },
      { lookup, allowPrivate: false }
    );
    assert.equal(r.success, false);
    assert.equal(r.status, 0);
    assert.match(r.error ?? "", /private|block/i);
  });

  it("blocks literal metadata / bad protocol before any network activity", async () => {
    const { lookup, calls } = countingLookup("93.184.216.34");
    const r1 = await deliverRaw("http://169.254.169.254/latest", { a: 1 }, { lookup });
    const r2 = await deliverRaw("file:///etc/passwd", { a: 1 }, { lookup });
    assert.equal(r1.success, false);
    assert.equal(r2.success, false);
    assert.equal(calls(), 0, "literal/invalid targets must never reach the resolver");
  });
});

describe("deliverWebhook — a guard block is terminal (no retry, no oracle)", () => {
  it("does not retry a target that resolves to a private ip: exactly one resolution, status 0", async () => {
    const { lookup, calls } = countingLookup("10.1.2.3");
    const r = await deliverWebhook("https://hook.example.test/x", payload, "whsec_test", 3, {
      lookup,
      allowPrivate: false,
    });
    assert.equal(r.success, false);
    assert.equal(r.status, 0);
    assert.match(r.error ?? "", /private|block/i);
    assert.equal(
      calls(),
      1,
      "blocked delivery must not be retried (4 resolutions would be an oracle)"
    );
  });

  it("does not retry metadata even under the private opt-in", async () => {
    const { lookup, calls } = countingLookup("169.254.169.254");
    const r = await deliverWebhook("https://hook.example.test/x", payload, null, 3, {
      lookup,
      allowPrivate: true,
    });
    assert.equal(r.success, false);
    assert.equal(r.status, 0);
    assert.equal(calls(), 1);
  });
});

describe("dispatcher — redirects are never followed; delivery still works (live loopback server)", () => {
  let server: Server;
  let requestCount = 0;
  let mode: "redirect" | "ok" | "fail500" = "ok";
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  let base = "";

  before(async () => {
    server = createServer((req, res) => {
      requestCount += 1;
      lastHeaders = req.headers;
      if (mode === "redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:9/internal-secret" });
        res.end();
        return;
      }
      if (mode === "fail500") {
        res.writeHead(500, { Connection: "close" });
        res.end("boom");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
      res.end("SECRET-INTERNAL-BODY");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("deliverRaw never follows a 3xx (no second request to the hop) and reports it as blocked", async () => {
    mode = "redirect";
    requestCount = 0;
    const r = await deliverRaw(`${base}/start`, { a: 1 }, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.success, false);
    assert.equal(r.status, 0, "the redirect status must not be surfaced as a delivery result");
    assert.match(r.error ?? "", /redirect/i);
    assert.equal(requestCount, 1, "the redirect target must NOT be fetched");
  });

  it("deliverWebhook never follows a 3xx and does not retry it", async () => {
    mode = "redirect";
    requestCount = 0;
    const r = await deliverWebhook(`${base}/start`, payload, "whsec_test", 3, {
      allowPrivate: true,
      timeoutMs: 3000,
    });
    assert.equal(r.success, false);
    assert.equal(r.status, 0);
    assert.equal(requestCount, 1, "a redirect is a terminal block, not a retryable 5xx");
  });

  it("deliverRaw still delivers to an allowed private target (functional regression guard)", async () => {
    mode = "ok";
    requestCount = 0;
    const r = await deliverRaw(`${base}/ping`, { a: 1 }, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.success, true);
    assert.equal(r.status, 200);
    assert.equal(requestCount, 1);
    assert.equal(lastHeaders["content-type"], "application/json");
  });

  it("deliverWebhook still signs and delivers (HMAC + event headers reach the server)", async () => {
    mode = "ok";
    requestCount = 0;
    const r = await deliverWebhook(`${base}/hook`, payload, "whsec_test", 3, {
      allowPrivate: true,
      timeoutMs: 3000,
    });
    assert.equal(r.success, true);
    assert.equal(r.status, 200);
    assert.equal(requestCount, 1);
    assert.match(String(lastHeaders["x-webhook-signature"] ?? ""), /^sha256=[0-9a-f]{64}$/);
    assert.equal(lastHeaders["x-webhook-event"], "test.ping");
    assert.equal(lastHeaders["x-webhook-timestamp"], payload.timestamp);
  });

  it("deliverWebhook still retries a genuine 5xx (retry semantics preserved for real upstream errors)", async () => {
    mode = "fail500";
    requestCount = 0;
    const r = await deliverWebhook(`${base}/flaky`, payload, null, 1, {
      allowPrivate: true,
      timeoutMs: 3000,
    });
    assert.equal(r.success, false);
    assert.equal(r.status, 500);
    assert.equal(requestCount, 2, "maxRetries=1 => two attempts on a 5xx");
  });
});
