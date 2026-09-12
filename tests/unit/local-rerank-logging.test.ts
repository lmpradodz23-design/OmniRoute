/**
 * Local rerank provider path of POST /v1/rerank — logging, /rerank fallback and (SSRF S-6)
 * the outbound guard on the provider-node base URL.
 *
 * The route reaches the local provider through the pinned guarded client (undici
 * dispatcher), which a `globalThis.fetch` mock does not intercept — the provider is stood in
 * by a real loopback server whose base URL is stored on the provider_node.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-rerank-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { invalidateDbCache } = await import("../../src/lib/db/readCache.ts");
const { createProviderNode, createProviderConnection } =
  await import("../../src/lib/db/providers.ts");
const { getCallLogs, getCallLogById, waitForCallLogSaves } =
  await import("../../src/lib/usage/callLogs.ts");
const { POST } = await import("../../src/app/api/v1/rerank/route.ts");

interface RerankSuccessResponse {
  results: Array<{ index: number; relevance_score: number }>;
}

interface CallLogRow {
  id: string;
  model: string;
  provider: string;
  status: number;
  error?: string;
  connectionId?: string;
}

type Mode = "ok" | "fallback" | "500" | "redirect";

test.describe("Local rerank provider logging and fallback", () => {
  let server: Server;
  let base = "";
  let mode: Mode = "ok";
  let hits: Array<{ url: string; auth?: string; body: string }> = [];

  test.before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        hits.push({ url: req.url ?? "", auth: req.headers.authorization, body: raw });
        const json = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        switch (mode) {
          case "fallback":
            if (req.url?.endsWith("/v1/rerank")) {
              res.writeHead(404, { "Content-Type": "text/plain" });
              return res.end("Not Found");
            }
            return json(200, { results: [{ index: 0, relevance_score: 0.99 }] });
          case "500":
            return json(500, { detail: "Local backend failure" });
          case "redirect":
            res.writeHead(302, { Location: "http://127.0.0.1:9/internal" });
            return res.end();
          default:
            return json(200, {
              results: [
                { index: 0, relevance_score: 0.95 },
                { index: 1, relevance_score: 0.2 },
              ],
            });
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = new Date().toISOString();
    // "vram" mounts under /v1 (→ /v1/rerank); "infinity" has no /v1 (→ /v1/rerank then /rerank);
    // "meta" points at cloud metadata and must never be reached.
    await createProviderNode({
      id: "vram",
      name: "vram",
      type: "openai",
      prefix: "vram",
      baseUrl: `${base}/v1`,
      createdAt: now,
      updatedAt: now,
    });
    await createProviderNode({
      id: "infinity",
      name: "infinity",
      type: "openai",
      prefix: "infinity",
      baseUrl: base,
      createdAt: now,
      updatedAt: now,
    });
    await createProviderNode({
      id: "meta",
      name: "meta",
      type: "openai",
      prefix: "meta",
      baseUrl: "http://169.254.169.254/v1",
      createdAt: now,
      updatedAt: now,
    });
    for (const provider of ["vram", "infinity", "meta"]) {
      await createProviderConnection({
        id: `conn-${provider}-1`,
        provider,
        authType: "apikey",
        name: `${provider}-local`,
        apiKey: "test-token",
        createdAt: now,
        updatedAt: now,
      });
    }
    invalidateDbCache("nodes");
    invalidateDbCache("connections");
  });

  test.beforeEach(() => {
    hits = [];
    mode = "ok";
  });

  test.after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    core.resetDbInstance();
    try {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  const rerankRequest = (model: string, documents: string[], query = "test query") =>
    new Request("http://localhost:20128/api/v1/rerank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, query, documents }),
    });

  test("successfully logs local rerank calls and attaches metadata headers", async () => {
    const res = await POST(
      rerankRequest("vram/BAAI/bge-reranker-v2-m3", ["doc1", "doc2"]),
      {} as Record<string, unknown>
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-omniroute-provider"), "vram");
    assert.equal(res.headers.get("x-omniroute-model"), "BAAI/bge-reranker-v2-m3");

    const json = (await res.json()) as RerankSuccessResponse;
    assert.equal(json.results.length, 2);

    // Wire contract: POST <base>/v1/rerank with the bearer and the upstream body shape.
    assert.equal(hits.length, 1);
    assert.equal(hits[0].url, "/v1/rerank");
    assert.equal(hits[0].auth, "Bearer test-token");
    const parsedBody = JSON.parse(hits[0].body);
    assert.equal(parsedBody.model, "BAAI/bge-reranker-v2-m3");
    assert.equal(parsedBody.query, "test query");
    assert.deepEqual(parsedBody.documents, ["doc1", "doc2"]);

    await waitForCallLogSaves(15000);

    const logs = (await getCallLogs({ limit: 10 })) as unknown as CallLogRow[];
    const logEntry = logs.find(
      (l) => l.model === "vram/BAAI/bge-reranker-v2-m3" && l.status === 200
    );
    assert.ok(logEntry, "Expected call log entry for local rerank");
    assert.equal(logEntry.provider, "vram");

    const detail = await getCallLogById(logEntry.id);
    assert.deepEqual(detail?.requestBody, {
      model: "vram/BAAI/bge-reranker-v2-m3",
      query: "test query",
      documents: ["doc1", "doc2"],
    });
    assert.deepEqual(detail?.responseBody, {
      results: [
        { index: 0, relevance_score: 0.95 },
        { index: 1, relevance_score: 0.2 },
      ],
    });
  });

  test("falls back from /v1/rerank to /rerank when local provider returns 404", async () => {
    mode = "fallback";
    const res = await POST(
      rerankRequest("infinity/bge-reranker-large", ["doc1"], "search"),
      {} as Record<string, unknown>
    );
    assert.equal(res.status, 200);
    assert.deepEqual(
      hits.map((h) => h.url),
      ["/v1/rerank", "/rerank"]
    );
  });

  test("records error call log when local provider returns 500", async () => {
    mode = "500";
    const res = await POST(
      rerankRequest("vram/BAAI/bge-reranker-v2-m3", ["doc1"]),
      {} as Record<string, unknown>
    );
    assert.equal(res.status, 500);

    await waitForCallLogSaves(15000);

    const logs = (await getCallLogs({ limit: 10 })) as unknown as CallLogRow[];
    const logEntry = logs.find(
      (l) => l.model === "vram/BAAI/bge-reranker-v2-m3" && l.status === 500
    );
    assert.ok(logEntry, "Expected 500 call log entry for local rerank failure");
    assert.equal(logEntry.provider, "vram");
    assert.equal(logEntry.error, "Local backend failure");
  });

  // The route's local allowlist (localhost / 127.0.0.1 / 172.16/12) already keeps a node
  // outside it — cloud metadata included — from being routed at all.
  test("a provider node outside the local allowlist is never routed (400, no socket)", async () => {
    const res = await POST(rerankRequest("meta/whatever", ["doc1"]), {} as Record<string, unknown>);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /Invalid rerank model/);
    assert.equal(hits.length, 0);
  });

  // SSRF S-6: inside the allowlist the request is pinned and redirect-free.

  test("S-6: a redirect from the local provider is never followed", async () => {
    mode = "redirect";
    const res = await POST(
      rerankRequest("vram/BAAI/bge-reranker-v2-m3", ["doc1"]),
      {} as Record<string, unknown>
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /blocked by the outbound guard/i);
    assert.equal(hits.length, 1, "the redirect target must not be requested");
  });
});
