import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { GenericMemoryBackend, createGenericMemoryBackend } from "../genericBackend";
import type { Memory } from "../types";
import { MemoryType } from "../types";
import type { WebhookLookupFn } from "@/shared/network/hardenedWebhookFetch";

// ────────────────────────────────────────────────────────────
// GenericMemoryBackend — unit tests
//
// SSRF S-6: the backend reaches its base URL through the pinned guarded client
// (undici dispatcher), which a `globalThis.fetch` mock does not intercept. The
// suite therefore runs against a real loopback stand-in that records every
// request and replies per test — the same URL/header/body/status contracts the
// old fetch spies asserted, observed on the wire instead.
// ────────────────────────────────────────────────────────────

const BACKEND_ID = "test-backend";
const BACKEND_NAME = "Test Backend";

type Hit = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
type Reply = { status: number; body?: string; headers?: Record<string, string>; delayMs?: number };

const json = (value: unknown, status = 200): Reply => ({
  status,
  body: JSON.stringify(value),
  headers: { "Content-Type": "application/json" },
});
const HEALTH_OK = json({ status: "ok" });

let server: Server;
let BASE_URL = "";
let hits: Hit[] = [];
let route: (hit: Hit) => Reply = () => HEALTH_OK;

/** Health answers ok; every other path gets `reply`. Mirrors the old mockHealthOkThen(). */
function healthOkThen(reply: Reply | ((hit: Hit) => Reply)) {
  route = (hit) =>
    hit.url.endsWith("/health") ? HEALTH_OK : typeof reply === "function" ? reply(hit) : reply;
}

const nonHealth = () => hits.find((h) => !h.url.endsWith("/health"))!;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const hit: Hit = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: raw,
      };
      hits.push(hit);
      const reply = route(hit);
      const send = () => {
        res.writeHead(reply.status, reply.headers ?? {});
        res.end(reply.body);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const SAMPLE_MEMORY: Memory = {
  id: "mem-001",
  apiKeyId: "key-1",
  sessionId: "sess-1",
  type: MemoryType.FACTUAL,
  key: "my-key",
  content: "Hello world",
  metadata: { source: "test" },
  embedding: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastAccessedAt: new Date("2026-01-01T00:00:00.000Z"),
  expiresAt: null,
};

const SAMPLE_MEMORY_JSON = {
  ...SAMPLE_MEMORY,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastAccessedAt: "2026-01-01T00:00:00.000Z",
};

// Loopback is admitted by the local-first integration policy in production; the
// unit suite pins `allowPrivate` explicitly so it never consults the settings DB.
function createBackend(configOverrides: Record<string, unknown> = {}) {
  return createGenericMemoryBackend(BACKEND_ID, BACKEND_NAME, {
    baseUrl: BASE_URL,
    network: { allowPrivate: true },
    ...configOverrides,
  });
}

const lookupTo =
  (address: string): WebhookLookupFn =>
  async () => [{ address, family: 4 }];

describe("GenericMemoryBackend", () => {
  let backend: GenericMemoryBackend;

  beforeEach(() => {
    hits = [];
    route = () => HEALTH_OK;
    backend = createBackend();
  });

  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("sets id and displayName from constructor args", () => {
      expect(backend.id).toBe(BACKEND_ID);
      expect(backend.displayName).toBe(BACKEND_NAME);
    });

    test("accepts custom timeout", () => {
      const b = createBackend({ timeout: 5000 });
      expect(b).toBeInstanceOf(GenericMemoryBackend);
    });
  });

  // ─── Health ──────────────────────────────────────────────

  describe("health()", () => {
    test("returns ok=true when backend responds 200 (GET /health)", async () => {
      const result = await backend.health();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(hits).toHaveLength(1);
      expect(hits[0].method).toBe("GET");
      expect(hits[0].url).toBe("/health");
    });

    test("returns ok=false when backend responds 500", async () => {
      route = () => ({ status: 500, body: "Internal error" });

      const result = await backend.health();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("HTTP 500");
    });

    test("returns ok=false on network failure (refused loopback port)", async () => {
      const probe = createServer();
      await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
      const closedPort = (probe.address() as AddressInfo).port;
      await new Promise<void>((r) => probe.close(() => r()));

      const b = createBackend({ baseUrl: `http://127.0.0.1:${closedPort}` });
      const result = await b.health();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/fetch failed|ECONNREFUSED/);
    });

    test("reports latency in ms", async () => {
      route = () => ({ ...HEALTH_OK, delayMs: 10 });

      const result = await backend.health();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(5);
    });
  });

  // ─── Initialize ──────────────────────────────────────────

  describe("initialize()", () => {
    test("calls health and throws on failure", async () => {
      route = () => ({ status: 503, body: "fail" });

      await expect(backend.initialize()).rejects.toThrow("Cannot connect to Test Backend");
    });

    test("passes when health succeeds", async () => {
      await expect(backend.initialize()).resolves.toBeUndefined();
    });
  });

  // ─── Create ──────────────────────────────────────────────

  describe("create()", () => {
    test("POSTs to /memories with input body", async () => {
      healthOkThen(json(SAMPLE_MEMORY));
      const input = {
        apiKeyId: "key-1",
        sessionId: "sess-1",
        type: MemoryType.FACTUAL,
        key: "my-key",
        content: "Hello world",
        metadata: {},
        expiresAt: null,
      };

      const result = await backend.create(input);

      expect(result).toEqual(SAMPLE_MEMORY_JSON);
      const hit = nonHealth();
      expect(hit.method).toBe("POST");
      expect(hit.url).toBe("/memories");
      expect(hit.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(hit.body)).toEqual(input);
    });

    test("uses custom create endpoint when configured", async () => {
      const b = createBackend({ endpoints: { create: "/api/v1/mem" } });
      healthOkThen(json(SAMPLE_MEMORY));

      await b.create({
        apiKeyId: "k1",
        sessionId: "s1",
        type: MemoryType.FACTUAL,
        key: "k",
        content: "c",
        metadata: {},
        expiresAt: null,
      });

      expect(new URL(nonHealth().url, BASE_URL).pathname).toBe("/api/v1/mem");
    });
  });

  // ─── Get ─────────────────────────────────────────────────

  describe("get()", () => {
    test("GETs /memories/{id} and returns memory", async () => {
      healthOkThen(json(SAMPLE_MEMORY));

      const result = await backend.get("mem-001");

      expect(result).toEqual(SAMPLE_MEMORY_JSON);
      expect(nonHealth().method).toBe("GET");
      expect(new URL(nonHealth().url, BASE_URL).pathname).toBe("/memories/mem-001");
    });

    test("returns null on 404", async () => {
      healthOkThen({ status: 404, body: "Not found" });

      const result = await backend.get("mem-999");

      expect(result).toBeNull();
    });

    test("throws on non-404 errors", async () => {
      healthOkThen({ status: 500, body: "Server error" });

      await expect(backend.get("mem-001")).rejects.toThrow("HTTP 500");
    });

    test("uses custom get endpoint with path params", async () => {
      const b = createBackend({
        endpoints: { get: "/records/{memoryId}" },
        pathParams: { memoryId: "memoryId" },
      });
      healthOkThen(json(SAMPLE_MEMORY));

      await b.get("mem-001");

      expect(new URL(nonHealth().url, BASE_URL).pathname).toBe("/records/mem-001");
    });
  });

  // ─── Update ──────────────────────────────────────────────

  describe("update()", () => {
    test("PATCHes /memories/{id} with updates", async () => {
      healthOkThen({ status: 204 });

      const result = await backend.update("mem-001", { content: "updated" });

      expect(result).toBe(true);
      expect(nonHealth().method).toBe("PATCH");
      expect(new URL(nonHealth().url, BASE_URL).pathname).toBe("/memories/mem-001");
      expect(JSON.parse(nonHealth().body)).toEqual({ content: "updated" });
    });

    test("returns false on 404", async () => {
      healthOkThen({ status: 404, body: "Not found" });

      const result = await backend.update("mem-999", { content: "x" });

      expect(result).toBe(false);
    });
  });

  // ─── Delete ──────────────────────────────────────────────

  describe("delete()", () => {
    test("DELETEs /memories/{id}", async () => {
      healthOkThen({ status: 204 });

      const result = await backend.delete("mem-001");

      expect(result).toBe(true);
      expect(nonHealth().method).toBe("DELETE");
      expect(new URL(nonHealth().url, BASE_URL).pathname).toBe("/memories/mem-001");
    });

    test("returns false on 404", async () => {
      healthOkThen({ status: 404, body: "Not found" });

      const result = await backend.delete("mem-999");

      expect(result).toBe(false);
    });
  });

  // ─── List ────────────────────────────────────────────────

  describe("list()", () => {
    test("GETs /memories with query params", async () => {
      healthOkThen(json({ data: [SAMPLE_MEMORY], total: 1, byType: { factual: 1 } }));

      const result = await backend.list({
        apiKeyId: "key-1",
        type: MemoryType.FACTUAL,
        limit: 10,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      const listUrl = nonHealth().url;
      expect(listUrl).toContain("apiKeyId=key-1");
      expect(listUrl).toContain("limit=10");
      expect(listUrl).toContain("offset=0");
    });

    test("applies custom query param names", async () => {
      const b = createBackend({
        queryParams: { apiKeyId: "owner", category: "memoryCategory", limit: "count" },
      });
      healthOkThen(json({ data: [], total: 0, byType: {} }));

      await b.list({ apiKeyId: "key-1", category: "codegraph", limit: 5 });
      const listUrl = nonHealth().url;

      expect(listUrl).toContain("owner=key-1");
      expect(listUrl).toContain("memoryCategory=codegraph");
      expect(listUrl).toContain("count=5");
      expect(listUrl).not.toContain("apiKeyId=");
      expect(listUrl).not.toContain("category=");
    });
  });

  // ─── Search ──────────────────────────────────────────────

  describe("search()", () => {
    test("GETs /memories/search with query params", async () => {
      healthOkThen(json([SAMPLE_MEMORY]));

      const result = await backend.search({
        query: "hello",
        apiKeyId: "key-1",
        strategy: "semantic",
        limit: 5,
      });

      expect(result).toHaveLength(1);
      const searchUrl = nonHealth().url;
      expect(searchUrl).toContain("/memories/search");
      expect(searchUrl).toContain("query=hello");
      expect(searchUrl).toContain("strategy=semantic");
    });

    test("uses custom search endpoint", async () => {
      const b = createBackend({ endpoints: { search: "/api/search" } });
      healthOkThen(json([]));

      await b.search({ query: "q", apiKeyId: "k" });

      expect(nonHealth().url).toContain("/api/search");
    });

    test("serializes options as JSON query param", async () => {
      healthOkThen(json([]));

      await backend.search({
        query: "hello",
        apiKeyId: "key-1",
        options: { filter: { lang: "en" } },
      });

      expect(nonHealth().url).toContain(
        encodeURIComponent(JSON.stringify({ filter: { lang: "en" } }))
      );
    });
  });

  // ─── Auth headers ────────────────────────────────────────

  describe("authentication", () => {
    test("sends Authorization header when apiKey is configured", async () => {
      const b = createBackend({ apiKey: "secret-123" });

      await b.health();

      expect(hits[0].headers.authorization).toBe("Bearer secret-123");
    });

    test("sends custom headers when configured", async () => {
      const b = createBackend({
        headers: { "X-Api-Key": "abc", "Notion-Version": "2022-06-28" },
      });

      await b.health();

      expect(hits[0].headers["x-api-key"]).toBe("abc");
      expect(hits[0].headers["notion-version"]).toBe("2022-06-28");
    });
  });

  // ─── Factory ─────────────────────────────────────────────

  describe("createGenericMemoryBackend factory", () => {
    test("returns a GenericMemoryBackend instance", () => {
      const b = createGenericMemoryBackend("fac", "Factory", { baseUrl: "http://x" });
      expect(b).toBeInstanceOf(GenericMemoryBackend);
      expect(b.id).toBe("fac");
    });
  });

  // ─── SSRF guard (S-6) ────────────────────────────────────
  //
  // Contract: cloud metadata is never reachable; private/LAN (loopback included)
  // only under the integration policy (`network.allowPrivate` pins it here);
  // classification is by the RESOLVED address, not just IP literals; redirects
  // are never followed. All decisions surface as "SSRF guard blocked …" without
  // a socket to the target.

  describe("SSRF prevention", () => {
    const strict = { allowPrivate: false };

    test("blocks the cloud-metadata literal even when private egress is allowed", async () => {
      const b = createBackend({
        baseUrl: "http://169.254.169.254/latest/meta-data/",
        network: { allowPrivate: true },
      });
      const result = await b.health();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSRF guard");
    });

    test("blocks a public hostname that RESOLVES to cloud metadata", async () => {
      const b = createBackend({
        baseUrl: "http://memory.example.test",
        network: { allowPrivate: true, lookup: lookupTo("169.254.169.254") },
      });
      const result = await b.health();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSRF guard");
      expect(hits).toHaveLength(0);
    });

    test("blocks a public hostname that RESOLVES to a private ip when private egress is off (the old IP-literal-only gap)", async () => {
      const b = createBackend({
        baseUrl: "http://memory.example.test",
        network: { allowPrivate: false, lookup: lookupTo("10.0.0.5") },
      });
      const result = await b.health();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSRF guard");
      expect(hits).toHaveLength(0);
    });

    test.each([
      ["loopback IPv4", "http://127.0.0.1:20128"],
      ["private IPv4 10/8", "http://10.0.0.5/api"],
      ["private IPv4 192.168/16", "http://192.168.1.100"],
      ["loopback IPv6", "http://[::1]:20128"],
      ["named local", "http://localhost:27123"],
    ])("blocks %s when private egress is off", async (_label, baseUrl) => {
      const b = createBackend({ baseUrl, network: strict });
      const result = await b.health();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSRF guard");
    });

    test("blocks non-http schemes (file://)", async () => {
      const b = createBackend({ baseUrl: "file:///etc/passwd", network: strict });
      const result = await b.health();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSRF guard");
    });

    test("admits a public hostname resolved to an allowed address and pins the connection to it", async () => {
      // The loopback stand-in answers, but the request carries the configured hostname.
      const b = createBackend({
        baseUrl: `http://memory.example.test:${new URL(BASE_URL).port}`,
        network: { allowPrivate: true, lookup: lookupTo("127.0.0.1") },
      });
      await expect(b.health()).resolves.toHaveProperty("ok", true);
      expect(hits[0].headers.host).toBe(`memory.example.test:${new URL(BASE_URL).port}`);
    });

    test("never follows a redirect from the admitted target", async () => {
      route = () => ({ status: 302, headers: { Location: "http://127.0.0.1:9/internal" } });
      const result = await backend.health();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSRF guard");
      expect(hits).toHaveLength(1);
    });

    test("SSRF guard fires during create() via request()", async () => {
      const b = createBackend({ baseUrl: "http://127.0.0.1:20128", network: strict });
      await expect(
        b.create({
          apiKeyId: "k1",
          sessionId: "s1",
          type: MemoryType.FACTUAL,
          key: "k",
          content: "c",
          metadata: {},
          expiresAt: null,
        })
      ).rejects.toThrow("SSRF guard");
    });
  });
});
