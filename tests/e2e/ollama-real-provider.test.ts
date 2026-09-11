// Real-provider gateway E2E: an ISOLATED OmniRoute instance (loopback bind, temp
// DATA_DIR, local OmniRoute API key) routing to a REAL, free, local model server —
// Ollama's OpenAI-compatible endpoint (http://127.0.0.1:11434/v1, model qwen2.5:3b).
//
// Unlike compat-isolated.test.ts (mock upstream), this proves the full path with real
// inference: /v1/models, /v1/chat/completions (JSON + SSE), /v1/messages (Anthropic
// format), /v1/responses (OpenAI Responses), client-side cancellation of a long stream
// followed by a healthy follow-up request, and a typed 401 for an invalid key.
//
// Harmless without Ollama: every test is skipped (with a clear reason) when
// OLLAMA_E2E_BASE_URL (default http://127.0.0.1:11434) does not answer /v1/models or
// does not list OLLAMA_E2E_MODEL (default qwen2.5:3b). No model is ever downloaded.
//
// Knobs: OLLAMA_E2E_PORT (default: free port), OLLAMA_E2E_DATA_DIR (parent for the
// temp DATA_DIR; default os.tmpdir()), OLLAMA_E2E_LOG_DIR (server log; default os.tmpdir()).
//
// Run: DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm \
//   --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts \
//   --test --test-force-exit --test-concurrency=1 tests/e2e/ollama-real-provider.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const OLLAMA_BASE_URL = (process.env.OLLAMA_E2E_BASE_URL || "http://127.0.0.1:11434").replace(
  /\/+$/,
  ""
);
const OLLAMA_V1 = `${OLLAMA_BASE_URL}/v1`;
const OLLAMA_MODEL = process.env.OLLAMA_E2E_MODEL || "qwen2.5:3b";
const PROVIDER_ID = "openai-compatible-ollama-e2e";
const PREFIX = "ollama";
const MODEL = `${PREFIX}/${OLLAMA_MODEL}`;
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR_PARENT = process.env.OLLAMA_E2E_DATA_DIR || os.tmpdir();
const LOG_DIR = process.env.OLLAMA_E2E_LOG_DIR || os.tmpdir();
const SERVER_READY_TIMEOUT_MS = 300_000; // Windows dev server can take minutes to compile
const INFERENCE_TIMEOUT_MS = 180_000;

// ─── Ollama availability probe (decides skip vs run before anything else) ─────
async function probeOllama(): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_V1}/models`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Ollama not reachable at ${OLLAMA_V1}/models (${message})` };
  }
  if (!res.ok) {
    return { ok: false, reason: `Ollama ${OLLAMA_V1}/models answered HTTP ${res.status}` };
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map((m) => String(m.id ?? ""));
  if (!ids.includes(OLLAMA_MODEL)) {
    return {
      ok: false,
      reason: `Ollama is up but model "${OLLAMA_MODEL}" is not pulled (available: ${ids.join(", ") || "none"})`,
    };
  }
  return { ok: true };
}

const ollama = await probeOllama();
const skip = ollama.ok ? false : `SKIPPED — ${ollama.reason}`;
if (skip) console.log(`[ollama-e2e] ${skip}`);

// ─── Isolated OmniRoute process (same pattern as compat-isolated.test.ts) ──────
let TEST_DATA_DIR = "";
let core: typeof import("../../src/lib/db/core.ts") | undefined;

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
    if (target.length > 2000) target.splice(0, target.length - 2000);
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
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    if (app.exitInfo) {
      throw new Error(
        `OmniRoute exited before ready (${JSON.stringify(app.exitInfo)})\n${app.stderrLines.slice(-30).join("\n")}`
      );
    }
    try {
      const res = await fetch(`${app.baseUrl}/api/monitoring/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return Date.now() - startedAt;
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

// ─── SSE helper ────────────────────────────────────────────────────────────────
interface SseEvent {
  event?: string;
  data: string;
}

async function readSse(
  response: Response,
  opts: { abortWhen?: (events: SseEvent[]) => boolean; controller?: AbortController } = {}
) {
  const events: SseEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = false;
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
    if (opts.abortWhen && opts.abortWhen(events)) {
      aborted = true;
      opts.controller?.abort();
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return { events, aborted };
}

function chatDeltaText(events: SseEvent[]) {
  return events
    .filter((e) => e.data !== "[DONE]")
    .map((e) => {
      try {
        return (JSON.parse(e.data).choices?.[0]?.delta?.content as string | undefined) ?? "";
      } catch {
        return "";
      }
    });
}

// ─── Fixture ───────────────────────────────────────────────────────────────────
let app: ReturnType<typeof createServerProcess> | undefined;
let clientKey = "";
let manageKey = "";

test.before(async () => {
  if (skip) return;
  TEST_DATA_DIR = fs.mkdtempSync(path.join(DATA_DIR_PARENT, "omniroute-ollama-e2e-"));
  process.env.DATA_DIR = TEST_DATA_DIR;
  process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
  process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "ollama-e2e-secret-123456";

  core = await import("../../src/lib/db/core.ts");
  const providersDb = await import("../../src/lib/db/providers.ts");
  const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
  const modelsDb = await import("../../src/lib/db/models.ts");
  const settingsDb = await import("../../src/lib/db/settings.ts");

  // Every case below must prove the REAL provider answered, so the semantic cache
  // (on by default; keyed by model+messages+temperature+top_p, NOT by client API
  // format) is disabled for this instance. With it on, the identical PONG prompt sent
  // via /v1/messages and then /v1/responses is served from cache — and in the wrong
  // client format (see the cross-format cache defect recorded with this suite).
  await settingsDb.updateSettings({ semanticCacheEnabled: false });

  // Same records the dashboard writes for a custom OpenAI-compatible provider:
  // provider node + API-key connection (Ollama ignores the token; "ollama" is the
  // conventional dummy) + the model added via "Add model".
  await providersDb.createProviderNode({
    id: PROVIDER_ID,
    type: "openai-compatible",
    name: "Ollama (local, E2E)",
    prefix: PREFIX,
    apiType: "chat",
    baseUrl: OLLAMA_V1,
  });
  await providersDb.createProviderConnection({
    provider: PROVIDER_ID,
    authType: "apikey",
    name: "ollama-local",
    apiKey: "ollama",
    isActive: true,
    testStatus: "active",
    providerSpecificData: { baseUrl: OLLAMA_V1, apiType: "chat" },
  });
  await modelsDb.addCustomModel(PROVIDER_ID, OLLAMA_MODEL, OLLAMA_MODEL, "manual");
  const client = await apiKeysDb.createApiKey("ollama-e2e-client", "ollama-e2e-machine", []);
  const manage = await apiKeysDb.createApiKey("ollama-e2e-manage", "ollama-e2e-machine", [
    "manage",
  ]);
  clientKey = client.key;
  manageKey = manage.key;
  core.closeDbInstance();

  const port = Number(process.env.OLLAMA_E2E_PORT) || (await getFreePort());
  app = createServerProcess(TEST_DATA_DIR, port);
  const readyMs = await waitForServer(app);
  console.log(`[ollama-e2e] OmniRoute ready on ${app.baseUrl} after ${readyMs} ms`);
});

test.after(async () => {
  if (app) {
    const logPath = path.join(LOG_DIR, "omniroute-ollama-e2e-server.log");
    fs.writeFileSync(
      logPath,
      ["--- stdout ---", ...app.stdoutLines, "--- stderr ---", ...app.stderrLines].join("\n")
    );
    console.log(`[ollama-e2e] server log written to ${logPath}`);
    await stopProcess(app.child);
  }
  core?.closeDbInstance();
  if (TEST_DATA_DIR) {
    await fsp.rm(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function auth(key = clientKey, extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extra };
}

async function post(pathname: string, body: unknown, init: RequestInit = {}) {
  return fetch(`${app!.baseUrl}${pathname}`, {
    method: "POST",
    headers: init.headers ?? auth(),
    body: JSON.stringify(body),
    signal: init.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });
}

// Positive proof that the REAL upstream answered: OmniRoute stamps every gateway
// response with X-OmniRoute-Cache (HIT when served from the semantic cache) and
// X-OmniRoute-Provider (the provider node that produced it).
function assertRealProvider(res: Response, label: string) {
  const cache = (res.headers.get("x-omniroute-cache") || "").toUpperCase();
  assert.notEqual(cache, "HIT", `${label}: served from the semantic cache, not from Ollama`);
  const provider = res.headers.get("x-omniroute-provider");
  if (provider) {
    assert.equal(provider.toLowerCase(), PROVIDER_ID, `${label}: X-OmniRoute-Provider`);
  }
  return `cache=${cache || "-"} provider=${provider || "-"}`;
}

const PONG_SYSTEM =
  "You are a test echo. Reply with exactly the single word PONG and nothing else.";
const pongMessages = [
  { role: "system", content: PONG_SYSTEM },
  { role: "user", content: "ping" },
];

// ─── a. /v1/models ─────────────────────────────────────────────────────────────
test("a. GET /v1/models lists the Ollama model through the gateway", { skip }, async (t) => {
  const startedAt = Date.now();
  const res = await fetch(`${app!.baseUrl}/v1/models`, {
    headers: auth(),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 400));
  const json = JSON.parse(text) as { object?: string; data: Array<{ id: string }> };
  assert.equal(json.object, "list");
  const ids = json.data.map((m) => m.id);
  assert.ok(ids.includes(MODEL), `expected ${MODEL} in ${JSON.stringify(ids)}`);
  t.diagnostic(`a. models=${JSON.stringify(ids)} latency=${Date.now() - startedAt}ms`);
});

// ─── b. /v1/chat/completions (JSON) ────────────────────────────────────────────
test("b. POST /v1/chat/completions (JSON) returns real PONG with usage", { skip }, async (t) => {
  const startedAt = Date.now();
  const res = await post("/v1/chat/completions", {
    model: MODEL,
    messages: pongMessages,
    temperature: 0,
    max_tokens: 16,
    stream: false,
  });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 400));
  const origin = assertRealProvider(res, "b");
  const json = JSON.parse(text);
  assert.equal(json.object, "chat.completion");
  assert.equal(json.choices?.[0]?.message?.role, "assistant");
  const content = String(json.choices?.[0]?.message?.content ?? "");
  assert.match(content, /pong/i, `content=${JSON.stringify(content)}`);
  assert.ok(json.usage?.completion_tokens > 0, `usage=${JSON.stringify(json.usage)}`);
  assert.ok(json.usage?.prompt_tokens > 0, `usage=${JSON.stringify(json.usage)}`);
  t.diagnostic(
    `b. content=${JSON.stringify(content)} usage=${JSON.stringify(json.usage)} model=${json.model} ${origin} latency=${Date.now() - startedAt}ms`
  );
});

// ─── c. /v1/chat/completions (SSE) ─────────────────────────────────────────────
test(
  "c. POST /v1/chat/completions (SSE) streams ≥2 content chunks and ends with [DONE]",
  { skip },
  async (t) => {
    const startedAt = Date.now();
    const res = await post("/v1/chat/completions", {
      model: MODEL,
      messages: [
        {
          role: "user",
          content: "Count from 1 to 10 separated by commas. Output only the numbers.",
        },
      ],
      temperature: 0,
      max_tokens: 64,
      stream: true,
    });
    if (res.status !== 200) assert.fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
    const { events } = await readSse(res);
    assert.ok(events.length >= 3, `only ${events.length} SSE events`);
    assert.equal(events.at(-1)?.data, "[DONE]", `last=${events.at(-1)?.data}`);
    const deltas = chatDeltaText(events).filter((d) => d.length > 0);
    assert.ok(
      deltas.length >= 2,
      `only ${deltas.length} content deltas: ${JSON.stringify(deltas)}`
    );
    const text = deltas.join("");
    assert.match(text, /1/, `text=${JSON.stringify(text)}`);
    assert.match(text, /10/, `text=${JSON.stringify(text)}`);
    const finishReasons = events
      .filter((e) => e.data !== "[DONE]")
      .map((e) => JSON.parse(e.data).choices?.[0]?.finish_reason)
      .filter(Boolean);
    assert.ok(finishReasons.includes("stop"), `finish_reasons=${JSON.stringify(finishReasons)}`);
    t.diagnostic(
      `c. sseEvents=${events.length} contentChunks=${deltas.length} text=${JSON.stringify(text)} latency=${Date.now() - startedAt}ms`
    );
  }
);

// ─── d. /v1/messages (Anthropic format) ────────────────────────────────────────
test("d. POST /v1/messages (Anthropic format) returns a real PONG message", { skip }, async (t) => {
  const startedAt = Date.now();
  const res = await post(
    "/v1/messages",
    {
      model: MODEL,
      max_tokens: 16,
      temperature: 0,
      system: PONG_SYSTEM,
      messages: [{ role: "user", content: "ping" }],
    },
    { headers: auth(clientKey, { "anthropic-version": "2023-06-01" }) }
  );
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 400));
  const origin = assertRealProvider(res, "d");
  const json = JSON.parse(text);
  assert.equal(json.type, "message");
  assert.equal(json.role, "assistant");
  assert.equal(json.content?.[0]?.type, "text");
  const content = String(json.content?.[0]?.text ?? "");
  assert.match(content, /pong/i, `content=${JSON.stringify(content)}`);
  assert.ok(json.usage?.output_tokens > 0, `usage=${JSON.stringify(json.usage)}`);
  assert.ok(json.usage?.input_tokens > 0, `usage=${JSON.stringify(json.usage)}`);
  t.diagnostic(
    `d. text=${JSON.stringify(content)} stop_reason=${json.stop_reason} usage=${JSON.stringify(json.usage)} ${origin} latency=${Date.now() - startedAt}ms`
  );
});

// ─── e. /v1/responses (OpenAI Responses format) ────────────────────────────────
test("e. POST /v1/responses (Responses format) returns a real PONG output", { skip }, async (t) => {
  const startedAt = Date.now();
  const res = await post("/v1/responses", {
    model: MODEL,
    instructions: PONG_SYSTEM,
    input: "ping",
    temperature: 0,
    max_output_tokens: 16,
  });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 400));
  const origin = assertRealProvider(res, "e");
  const json = JSON.parse(text);
  assert.equal(json.object, "response", `body=${text.slice(0, 600)}`);
  const outputText: string =
    json.output_text ??
    (json.output ?? [])
      .flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .join("");
  assert.match(outputText, /pong/i, `output=${JSON.stringify(json.output).slice(0, 400)}`);
  t.diagnostic(
    `e. output_text=${JSON.stringify(outputText)} status=${json.status} usage=${JSON.stringify(json.usage)} ${origin} latency=${Date.now() - startedAt}ms`
  );
});

// ─── f. client cancellation of a long stream ───────────────────────────────────
test(
  "f. cancelling a long stream is recorded by the instance and a follow-up request answers in <30s",
  { skip },
  async (t) => {
    const stderrBefore = app!.stderrLines.length;
    const controller = new AbortController();
    const startedAt = Date.now();
    const res = await post(
      "/v1/chat/completions",
      {
        model: MODEL,
        messages: [
          {
            role: "user",
            content: "Conte de 1 a 500 por extenso, um número por linha, sem parar e sem resumir.",
          },
        ],
        temperature: 0,
        stream: true,
      },
      { signal: controller.signal }
    );
    assert.equal(res.status, 200);
    const { events, aborted } = await readSse(res, {
      controller,
      abortWhen: (evs) => chatDeltaText(evs).filter((d) => d.length > 0).length >= 2,
    });
    const abortedAt = Date.now();
    assert.equal(aborted, true, "client aborted after the 2nd content chunk");
    const receivedText = chatDeltaText(events).join("");
    assert.ok(receivedText.length > 0, "received real content before aborting");
    assert.ok(
      !events.some((e) => e.data === "[DONE]"),
      "stream was cut before [DONE] (otherwise the model finished 1..500 in 2 chunks)"
    );

    // The instance must register the end of the cancelled call: the management
    // call-log feed (dashboard "Recent requests") shows in-flight rows as
    // `active: true`; once the abort propagates none may remain for our model.
    let rows: Array<Record<string, unknown>> = [];
    let activeRows: Array<Record<string, unknown>> = [];
    const deadline = Date.now() + 30_000;
    for (;;) {
      const list = await fetch(`${app!.baseUrl}/api/usage/call-logs?limit=50`, {
        headers: auth(manageKey),
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(list.status, 200, await list.clone().text());
      rows = (await list.json()) as Array<Record<string, unknown>>;
      activeRows = rows.filter((r) => r.active === true);
      if (activeRows.length === 0 || Date.now() > deadline) break;
      await sleep(500);
    }
    const settledMs = Date.now() - abortedAt;
    assert.equal(
      activeRows.length,
      0,
      `instance still reports in-flight calls ${settledMs}ms after the client abort: ${JSON.stringify(activeRows).slice(0, 600)}`
    );
    const ourRows = rows.filter((r) => String(r.model ?? "").includes(OLLAMA_MODEL));
    assert.ok(
      ourRows.length >= 1,
      `no call-log rows for ${OLLAMA_MODEL}: ${JSON.stringify(rows).slice(0, 400)}`
    );

    const newStderr = app!.stderrLines.slice(stderrBefore);
    const crashLines = newStderr.filter((l) => /unhandled|uncaught|ERR_STREAM|EPIPE/i.test(l));
    assert.deepEqual(
      crashLines,
      [],
      `server logged errors after the abort:\n${crashLines.join("\n")}`
    );

    // Follow-up request must answer normally and fast (the cancelled generation
    // must not keep the gateway or the local model busy).
    const followUpStart = Date.now();
    const follow = await post(
      "/v1/chat/completions",
      { model: MODEL, messages: pongMessages, temperature: 0, max_tokens: 16, stream: false },
      { signal: AbortSignal.timeout(30_000) }
    );
    const followText = await follow.text();
    const followUpMs = Date.now() - followUpStart;
    assert.equal(follow.status, 200, followText.slice(0, 400));
    const followOrigin = assertRealProvider(follow, "f follow-up");
    const followJson = JSON.parse(followText);
    assert.match(
      String(followJson.choices?.[0]?.message?.content ?? ""),
      /pong/i,
      followText.slice(0, 200)
    );
    assert.ok(followUpMs < 30_000, `follow-up took ${followUpMs}ms`);
    t.diagnostic(
      `f. chunksBeforeAbort=${events.length} received=${JSON.stringify(receivedText)} abortAfter=${abortedAt - startedAt}ms settled=${settledMs}ms callLogRows=${rows.length} followUp=${followUpMs}ms ${followOrigin} content=${JSON.stringify(followJson.choices?.[0]?.message?.content)}`
    );
  }
);

// ─── g. invalid key ────────────────────────────────────────────────────────────
test(
  "g. an invalid API key gets a typed 401 JSON error (no upstream call)",
  { skip },
  async (t) => {
    const res = await post(
      "/v1/chat/completions",
      { model: MODEL, messages: pongMessages, stream: false },
      { headers: auth("sk-omniroute-invalid-key-0000"), signal: AbortSignal.timeout(30_000) }
    );
    const text = await res.text();
    assert.equal(res.status, 401, text.slice(0, 300));
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    // Typed error contract of the auth boundary: {"error":{"code":"AUTH_002","message":...}}
    // (compat-isolated asserts `message` only; the code is what a client can switch on).
    const json = JSON.parse(text) as { error?: { message?: string; code?: string } };
    assert.equal(typeof json.error?.message, "string", text.slice(0, 300));
    assert.match(String(json.error?.code ?? ""), /^AUTH_\d+$/, text.slice(0, 300));

    const anon = await post(
      "/v1/chat/completions",
      { model: MODEL, messages: pongMessages, stream: false },
      { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000) }
    );
    assert.equal(anon.status, 401);
    t.diagnostic(`g. invalidKey=${res.status} body=${text.slice(0, 160)} anonymous=${anon.status}`);
  }
);
