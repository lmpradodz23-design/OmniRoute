// Fase 6 (audit/05-EXECUTION-PLAN.md): client compatibility against an ISOLATED OmniRoute
// instance (loopback bind, free port, temp DATA_DIR, local OmniRoute API key, mock
// OpenAI-compatible upstream — no real provider, no credentials, no cost).
//
// Covers the public contract every harness relies on: /v1/models, /v1/chat/completions
// (JSON + SSE), /v1/messages (Anthropic format — Claude Code), /v1/responses (Codex),
// usage accounting, typed errors (401 / unknown model / upstream failure), client-side
// cancellation propagating to the upstream, and MCP over streamable HTTP.
//
// Run: npm run test:compat
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-compat-"));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "compat-isolated-secret-123456";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const modelsDb = await import("../../src/lib/db/models.ts");

// ─── Mock OpenAI-compatible upstream (JSON + SSE + abort observation) ─────────────
interface UpstreamCall {
  body: Record<string, unknown>;
  stream: boolean;
  aborted: boolean;
  finished: boolean;
  startedAt: number;
  chunkTimes: number[];
  closedAt: number | null;
}

class MockOpenAiUpstream {
  calls: UpstreamCall[] = [];
  failNext: { status: number; message: string } | null = null;
  streamChunks = 4;
  streamChunkDelayMs = 20;
  private server: http.Server | null = null;
  baseUrl = "";

  async start() {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", () => resolve()));
    const address = this.server.address() as net.AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
    return this.baseUrl;
  }

  async stop() {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");

    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "test-model", object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `unhandled ${req.method} ${req.url}` } }));
      return;
    }
    if (String(req.headers.authorization || "") !== "Bearer sk-mock-upstream") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad upstream token" } }));
      return;
    }

    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const call: UpstreamCall = {
      body,
      stream: body.stream === true,
      aborted: false,
      finished: false,
      startedAt: Date.now(),
      chunkTimes: [],
      closedAt: null,
    };
    this.calls.push(call);
    // IncomingMessage "close" fires as soon as the request body is consumed (Node >= 16),
    // so a client disconnect must be observed on the RESPONSE: "close" before the
    // response finished writing means the peer (OmniRoute) tore the socket down.
    res.on("close", () => {
      call.closedAt = Date.now();
      if (!res.writableFinished) call.aborted = true;
    });

    if (this.failNext) {
      const { status, message } = this.failNext;
      this.failNext = null;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message, type: "server_error" } }));
      call.finished = true;
      return;
    }

    const id = `chatcmpl_${Math.random().toString(16).slice(2, 10)}`;
    if (!call.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "mock reply" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        })
      );
      call.finished = true;
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    // Snapshot per call: a test may reset the knobs while this stream is still running.
    const totalChunks = this.streamChunks;
    const chunkDelayMs = this.streamChunkDelayMs;
    for (let i = 0; i < totalChunks; i += 1) {
      if (call.aborted) return;
      call.chunkTimes.push(Date.now());
      send({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: i === 0 ? { role: "assistant", content: `tok${i} ` } : { content: `tok${i} ` },
            finish_reason: null,
          },
        ],
      });
      await new Promise((r) => setTimeout(r, chunkDelayMs));
    }
    if (call.aborted) return;
    send({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 7,
        completion_tokens: totalChunks,
        total_tokens: 7 + totalChunks,
      },
    });
    res.write("data: [DONE]\n\n");
    res.end();
    call.finished = true;
  }
}

// ─── Isolated OmniRoute process ────────────────────────────────────────────────
function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createServerProcess(dataDir: string, port: number) {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const child = spawn(process.execPath, ["scripts/dev/run-next-playwright.mjs", "dev"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      DASHBOARD_PORT: String(port),
      API_PORT: String(port),
      HOST: "127.0.0.1",
      REQUIRE_API_KEY: "true",
      API_KEY_SECRET: process.env.API_KEY_SECRET,
      DISABLE_SQLITE_AUTO_BACKUP: "true",
      INITIAL_PASSWORD: "",
      NEXT_TELEMETRY_DISABLED: "1",
      OMNIROUTE_DISABLE_BACKGROUND_SERVICES: "true",
      OMNIROUTE_DISABLE_TOKEN_HEALTHCHECK: "true",
      OMNIROUTE_DISABLE_LOCAL_HEALTHCHECK: "true",
      OMNIROUTE_HIDE_HEALTHCHECK_LOGS: "true",
      OMNIROUTE_E2E_BOOTSTRAP_MODE: "open",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.once("exit", (code, signal) => {
    exitInfo = { code, signal };
  });
  const keep = (target: string[]) => (chunk: Buffer | string) => {
    target.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    if (target.length > 200) target.splice(0, target.length - 200);
  };
  child.stdout.on("data", keep(stdoutLines));
  child.stderr.on("data", keep(stderrLines));
  return {
    child,
    stdoutLines,
    stderrLines,
    baseUrl: `http://127.0.0.1:${port}`,
    get exitInfo() {
      return exitInfo;
    },
  };
}

async function waitForServer(app: ReturnType<typeof createServerProcess>) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 180_000) {
    if (app.exitInfo) {
      throw new Error(
        `OmniRoute exited before ready (${JSON.stringify(app.exitInfo)})\n${app.stderrLines.slice(-30).join("\n")}`
      );
    }
    try {
      const res = await fetch(`${app.baseUrl}/api/monitoring/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for OmniRoute: ${lastError}\n${app.stderrLines.slice(-30).join("\n")}`
  );
}

async function stopProcess(child: ReturnType<typeof spawn>) {
  if (child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    sleep(5_000).then(() => false),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

// ─── SSE helpers ───────────────────────────────────────────────────────────────
async function readSse(
  response: Response,
  opts: { abortAfterEvents?: number; controller?: AbortController } = {}
) {
  const events: Array<{ event?: string; data: string }> = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      break; // aborted
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      let event: string | undefined;
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length) events.push({ event, data: data.join("\n") });
    }
    if (opts.abortAfterEvents && events.length >= opts.abortAfterEvents) {
      opts.controller?.abort();
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return events;
}

const upstream = new MockOpenAiUpstream();
let app: ReturnType<typeof createServerProcess> | undefined;
let clientKey = "";
let mcpKey = "";
const MODEL = "compat/test-model";

test.before(async () => {
  const baseUrl = await upstream.start();
  await providersDb.createProviderNode({
    id: "openai-compatible-compat",
    type: "openai-compatible",
    name: "Compat mock",
    prefix: "compat",
    apiType: "chat",
    baseUrl,
  });
  await providersDb.createProviderConnection({
    provider: "openai-compatible-compat",
    authType: "apikey",
    name: "compat-conn",
    apiKey: "sk-mock-upstream",
    isActive: true,
    testStatus: "active",
    providerSpecificData: { baseUrl, apiType: "chat" },
  });
  // The model catalog lists a custom provider's models once they are added/discovered
  // (dashboard "Add model" / "Sync models"); seed the same record the UI writes.
  await modelsDb.addCustomModel("openai-compatible-compat", "test-model", "Test model", "manual");
  const client = await apiKeysDb.createApiKey("compat-client", "compat-machine", []);
  const mcp = await apiKeysDb.createApiKey("compat-mcp", "compat-machine", ["mcp:connect"]);
  clientKey = client.key;
  mcpKey = mcp.key;
  await settingsDb.updateSettings({ mcpEnabled: true, mcpTransport: "streamable-http" });
  core.closeDbInstance();

  app = createServerProcess(TEST_DATA_DIR, await getFreePort());
  await waitForServer(app);
});

test.after(async () => {
  if (app) {
    const logPath = path.join(os.tmpdir(), "omniroute-compat-server.log");
    fs.writeFileSync(
      logPath,
      ["--- stdout ---", ...app.stdoutLines, "--- stderr ---", ...app.stderrLines].join("\n")
    );
    console.log(`[compat] server log written to ${logPath}`);
    await stopProcess(app.child);
  }
  await upstream.stop();
  core.closeDbInstance();
  await fsp.rm(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function auth(key = clientKey, extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extra };
}

async function post(pathname: string, body: unknown, init: RequestInit = {}) {
  return fetch(`${app!.baseUrl}${pathname}`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(body),
    signal: init.signal ?? AbortSignal.timeout(120_000),
    ...init,
  });
}

test("GET /v1/models lists the mock model and rejects a missing key with a typed 401", async () => {
  const ok = await fetch(`${app!.baseUrl}/v1/models`, {
    headers: auth(),
    signal: AbortSignal.timeout(120_000),
  });
  const okText = await ok.text();
  assert.equal(ok.status, 200, okText.slice(0, 400));
  const json = JSON.parse(okText) as { data: Array<{ id: string }> };
  assert.ok(
    json.data.some((m) => m.id === MODEL),
    JSON.stringify(json.data.map((m) => m.id))
  );

  const anon = await fetch(`${app!.baseUrl}/v1/models`, { signal: AbortSignal.timeout(60_000) });
  assert.equal(anon.status, 401);
  const err = (await anon.json()) as { error?: { message?: string } };
  assert.equal(typeof err.error?.message, "string", JSON.stringify(err));
});

test("POST /v1/chat/completions (JSON) returns the upstream reply with usage", async () => {
  const res = await post("/v1/chat/completions", {
    model: MODEL,
    messages: [{ role: "user", content: "hello" }],
    stream: false,
  });
  const bodyText = await res.text();
  assert.equal(res.status, 200, bodyText.slice(0, 400));
  const json = JSON.parse(bodyText);
  assert.equal(json.object, "chat.completion");
  assert.equal(json.choices[0].message.content, "mock reply");
  assert.equal(json.usage.total_tokens, 9);
  assert.ok(upstream.calls.at(-1)?.body.model === "test-model", "prefix stripped before upstream");
});

test("POST /v1/chat/completions (SSE) streams chunks and terminates with [DONE]", async () => {
  const res = await post("/v1/chat/completions", {
    model: MODEL,
    messages: [{ role: "user", content: "stream please" }],
    stream: true,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
  const events = await readSse(res);
  assert.equal(events.at(-1)?.data, "[DONE]");
  const text = events
    .filter((e) => e.data !== "[DONE]")
    .map((e) => JSON.parse(e.data).choices?.[0]?.delta?.content ?? "")
    .join("");
  assert.equal(text, "tok0 tok1 tok2 tok3 ");
});

test("POST /v1/messages (Anthropic format, Claude Code) — JSON and SSE", async () => {
  const res = await post("/v1/messages", {
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: "hi from claude code" }],
  });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.type, "message");
  assert.equal(json.role, "assistant");
  assert.equal(json.content[0].type, "text");
  assert.equal(json.content[0].text, "mock reply");
  assert.equal(typeof json.usage.input_tokens, "number");
  assert.equal(typeof json.usage.output_tokens, "number");

  const streamed = await post("/v1/messages", {
    model: MODEL,
    max_tokens: 64,
    stream: true,
    messages: [{ role: "user", content: "stream" }],
  });
  assert.equal(streamed.status, 200);
  const events = await readSse(streamed);
  const names = events.map((e) => e.event ?? JSON.parse(e.data).type);
  assert.ok(names.includes("message_start"), names.join(","));
  assert.ok(names.includes("content_block_delta"), names.join(","));
  assert.ok(names.includes("message_stop"), names.join(","));
  const text = events
    .filter((e) => (e.event ?? JSON.parse(e.data).type) === "content_block_delta")
    .map((e) => JSON.parse(e.data).delta?.text ?? "")
    .join("");
  assert.equal(text, "tok0 tok1 tok2 tok3 ");
});

test("POST /v1/responses (Codex) — JSON and SSE", async () => {
  const res = await post("/v1/responses", { model: MODEL, input: "hi from codex" });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.object, "response");
  const outputText =
    json.output_text ??
    (json.output ?? [])
      .flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .join("");
  assert.equal(outputText, "mock reply");

  const streamed = await post("/v1/responses", { model: MODEL, input: "stream", stream: true });
  assert.equal(streamed.status, 200);
  const events = await readSse(streamed);
  const names = events.map((e) => e.event ?? JSON.parse(e.data).type);
  assert.ok(names.includes("response.completed"), names.join(","));
  assert.ok(
    names.some((n) => n === "response.output_text.delta"),
    names.join(",")
  );
});

test("client cancellation of a stream aborts the upstream request", async () => {
  upstream.streamChunks = 40;
  upstream.streamChunkDelayMs = 250;
  const before = upstream.calls.length;
  const controller = new AbortController();
  try {
    const res = await post(
      "/v1/chat/completions",
      { model: MODEL, messages: [{ role: "user", content: "long" }], stream: true },
      { signal: controller.signal }
    );
    assert.equal(res.status, 200);
    await readSse(res, { abortAfterEvents: 2, controller });
  } finally {
    upstream.streamChunks = 4;
    upstream.streamChunkDelayMs = 20;
  }
  const abortedAt = Date.now();
  const call = upstream.calls[before];
  assert.ok(call?.stream, "upstream received the streaming call");
  const deadline = Date.now() + 15_000;
  while (!call.aborted && !call.finished && Date.now() < deadline) await sleep(100);
  const streamLog = app!.stdoutLines.filter((l) => l.includes("[STREAM]")).slice(-4);
  const timeline = {
    clientAbortAfterMs: abortedAt - call.startedAt,
    upstreamChunksSent: call.chunkTimes.length,
    upstreamClosedAfterMs: call.closedAt === null ? null : call.closedAt - call.startedAt,
    finished: call.finished,
    streamLog,
  };
  assert.equal(
    call.aborted,
    true,
    `upstream saw the client disconnect before the stream finished: ${JSON.stringify(timeline)}`
  );
  assert.equal(call.finished, false);
});

test("typed errors: unknown model and upstream 500 both surface as JSON error objects", async () => {
  const unknown = await post("/v1/chat/completions", {
    model: "no-such-provider/does-not-exist-anywhere",
    messages: [{ role: "user", content: "x" }],
  });
  const unknownText = await unknown.text();
  assert.ok(
    unknown.status >= 400 && unknown.status < 500,
    `status ${unknown.status}: ${unknownText.slice(0, 300)}`
  );
  const unknownJson = JSON.parse(unknownText);
  assert.equal(typeof unknownJson.error?.message, "string", JSON.stringify(unknownJson));

  upstream.failNext = { status: 500, message: "upstream exploded" };
  const failed = await post("/v1/chat/completions", {
    model: MODEL,
    messages: [{ role: "user", content: "x" }],
  });
  assert.ok(failed.status >= 400, `status ${failed.status}`);
  const failedJson = await failed.json();
  assert.equal(typeof failedJson.error?.message, "string", JSON.stringify(failedJson));
  assert.equal(upstream.failNext, null, "the mock consumed the planned failure");
});

test("MCP over streamable HTTP: initialize with an mcp:connect key", async () => {
  const res = await fetch(`${app!.baseUrl}/api/mcp/stream`, {
    method: "POST",
    headers: auth(mcpKey, { Accept: "application/json, text/event-stream" }),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "compat-e2e", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 300));
  const payload = text.trimStart().startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(
        text
          .split("\n")
          .find((line) => line.startsWith("data:"))!
          .slice(5)
      );
  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(typeof payload.result?.serverInfo?.name, "string", JSON.stringify(payload));
  assert.ok(res.headers.get("mcp-session-id"), "session id issued");
});
