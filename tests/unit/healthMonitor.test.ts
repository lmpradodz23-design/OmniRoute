/**
 * versionManager/healthMonitor — checkHealth + monitoring lifecycle.
 *
 * SSRF S-6: the health probe goes through the pinned guarded client (undici dispatcher),
 * which a `globalThis.fetch` mock does not intercept — the suite runs against a loopback
 * stand-in that records requests and replies per test.
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type Reply = { status: number; body: string };
let server: Server;
let base = "";
let hits: Array<{ url: string; auth?: string }> = [];
let reply: Reply = { status: 200, body: JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }) };

async function closedLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

before(async () => {
  server = createServer((req, res) => {
    hits.push({ url: req.url ?? "", auth: req.headers.authorization });
    if (reply.status === 302) {
      res.writeHead(302, { Location: "http://127.0.0.1:9/internal" });
      return res.end();
    }
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("healthMonitor", () => {
  let mod: typeof import("../../src/lib/versionManager/healthMonitor.ts");
  beforeEach(async () => {
    hits = [];
    reply = { status: 200, body: JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }) };
    mod = await import("../../src/lib/versionManager/healthMonitor.ts");
    mod.stopMonitoring("test-tool");
    mod.stopMonitoring("tool-a");
    mod.stopMonitoring("tool-b");
  });

  afterEach(() => {
    mod.stopMonitoring("test-tool");
    mod.stopMonitoring("tool-a");
    mod.stopMonitoring("tool-b");
  });

  describe("checkHealth", () => {
    it("should return healthy for 200 with models (GET /v1/models, internal bearer)", async () => {
      const r = await mod.checkHealth(base);
      assert.equal(r.healthy, true);
      assert.equal(r.modelCount, 2);
      assert.equal(r.error, null);
      assert.ok(r.latency >= 0);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].url, "/v1/models");
      assert.equal(hits[0].auth, "Bearer omniroute-internal");
    });

    it("should return unhealthy for non-200", async () => {
      reply = { status: 503, body: "{}" };
      const r = await mod.checkHealth(base);
      assert.equal(r.healthy, false);
      assert.equal(r.modelCount, 0);
      assert.equal(r.error, "HTTP 503");
    });

    it("should return unhealthy on network error (refused loopback port)", async () => {
      const r = await mod.checkHealth(`http://127.0.0.1:${await closedLoopbackPort()}`);
      assert.equal(r.healthy, false);
      assert.match(String(r.error), /fetch failed|ECONNREFUSED/);
    });

    it("should handle non-array data.data", async () => {
      reply = { status: 200, body: JSON.stringify({ data: "not-array" }) };
      const r = await mod.checkHealth(base);
      assert.equal(r.healthy, true);
      assert.equal(r.modelCount, 0);
    });

    it("should use custom health path", async () => {
      reply = { status: 200, body: JSON.stringify({ data: [] }) };
      await mod.checkHealth(base, "/health");
      assert.equal(hits[0].url, "/health");
    });

    it("should default to /v1/models", async () => {
      reply = { status: 200, body: JSON.stringify({ data: [] }) };
      await mod.checkHealth(base);
      assert.equal(hits[0].url, "/v1/models");
    });

    it("should return unhealthy for 500", async () => {
      reply = { status: 500, body: "{}" };
      const r = await mod.checkHealth(base);
      assert.equal(r.healthy, false);
      assert.equal(r.error, "HTTP 500");
    });

    // SSRF S-6: the managed-tool URL is operator data — never a socket to cloud metadata,
    // never a followed redirect; the guard decision is reported, not a wire error.
    it("blocks a cloud-metadata tool URL before any socket", async () => {
      const r = await mod.checkHealth("http://169.254.169.254:8317");
      assert.equal(r.healthy, false);
      assert.match(String(r.error), /blocked/i);
      assert.equal(hits.length, 0);
    });

    it("never follows a redirect from the tool", async () => {
      reply = { status: 302, body: "" };
      const r = await mod.checkHealth(base);
      assert.equal(r.healthy, false);
      assert.match(String(r.error), /redirect blocked/i);
      assert.equal(hits.length, 1);
    });
  });

  describe("startMonitoring / stopMonitoring / isMonitoring", () => {
    it("should start and stop monitoring", () => {
      mod.startMonitoring("tool-a", base, 60_000);
      assert.equal(mod.isMonitoring("tool-a"), true);
      mod.stopMonitoring("tool-a");
      assert.equal(mod.isMonitoring("tool-a"), false);
    });

    it("should replace previous monitoring on re-start", () => {
      mod.startMonitoring("tool-b", base, 60_000);
      mod.startMonitoring("tool-b", base, 30_000);
      assert.equal(mod.isMonitoring("tool-b"), true);
      mod.stopMonitoring("tool-b");
    });

    it("should return false for non-monitored tool", () => {
      assert.equal(mod.isMonitoring("nonexistent"), false);
    });

    it("should handle stopMonitoring for non-existent tool", () => {
      assert.doesNotThrow(() => mod.stopMonitoring("ghost"));
    });
  });
});
