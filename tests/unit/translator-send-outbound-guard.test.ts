/**
 * Regression for SSRF finding S-6 (Fase 1): POST /api/translator/send forwards a request to
 * the provider's base URL — for OpenAI-compatible connections that URL is operator data
 * (`providerSpecificData.baseUrl`). The route must go through the pinned guarded client:
 * resolved address validated, cloud metadata never, redirects never followed; a guard
 * decision is a 400 (configuration error) reported without the URL, not a generic 500.
 *
 * Handler is invoked directly (no middleware), against a loopback provider stand-in.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-translator-send-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createProviderConnection } = await import("../../src/lib/db/providers.ts");
const { POST } = await import("../../src/app/api/translator/send/route.ts");

let server: Server;
let base = "";
let mode: "ok" | "redirect" | "500" = "ok";
let hits: Array<{ url: string; auth?: string; body: string }> = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      hits.push({ url: req.url ?? "", auth: req.headers.authorization, body: raw });
      if (mode === "redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:9/internal" });
        return res.end();
      }
      if (mode === "500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const now = new Date().toISOString();
  await createProviderConnection({
    id: "conn-compat-loop",
    provider: "openai-compatible-loop",
    authType: "apikey",
    name: "loop",
    apiKey: "sk-loop-test",
    providerSpecificData: { baseUrl: `${base}/v1` },
    createdAt: now,
    updatedAt: now,
  });
  await createProviderConnection({
    id: "conn-compat-meta",
    provider: "openai-compatible-meta",
    authType: "apikey",
    name: "meta",
    apiKey: "sk-meta-test",
    providerSpecificData: { baseUrl: "http://169.254.169.254/v1" },
    createdAt: now,
    updatedAt: now,
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  core.resetDbInstance();
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // ignore
  }
});

const send = (provider: string) =>
  POST(
    new Request("http://localhost/api/translator/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        body: { model: "test-model", messages: [{ role: "user", content: "hi" }], stream: true },
      }),
    })
  );

test("S-6 translator/send: forwards to the configured base with the bearer and streams the reply", async () => {
  hits = [];
  mode = "ok";
  const res = await send("openai-compatible-loop");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  assert.match(text, /"content":"hi"/);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "/v1/chat/completions");
  assert.equal(hits[0].auth, "Bearer sk-loop-test");
  assert.equal(JSON.parse(hits[0].body).model, "test-model");
});

test("S-6 translator/send: upstream non-2xx is passed through as before", async () => {
  hits = [];
  mode = "500";
  const res = await send("openai-compatible-loop");
  assert.equal(res.status, 500);
  const body = (await res.json()) as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.match(body.error, /upstream exploded/);
});

test("S-6 translator/send: a cloud-metadata base URL is blocked before any socket (400, URL-free)", async () => {
  hits = [];
  const res = await send("openai-compatible-meta");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.match(body.error, /blocked by the outbound guard/i);
  assert.doesNotMatch(body.error, /169\.254/);
  assert.equal(hits.length, 0);
});

test("S-6 translator/send: a redirect from the provider is never followed", async () => {
  hits = [];
  mode = "redirect";
  const res = await send("openai-compatible-loop");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /blocked by the outbound guard/i);
  assert.equal(hits.length, 1, "the redirect target must not be requested");
});
