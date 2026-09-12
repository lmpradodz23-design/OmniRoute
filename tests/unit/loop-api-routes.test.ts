/**
 * Rotas do Loop Engine (/api/loop*) — contrato HTTP de ponta a ponta contra o DB real.
 *
 * Cobre (auditoria A, M1/M2 + testes que faltavam #3/#4):
 * - 401/403 sem auth quando o login e obrigatorio (requireManagementAuth);
 * - 404 com a flag LOOP_ENGINE_ENABLED desligada (default OFF);
 * - 400 para `budget` invalido (tipo errado, <= 0, NaN/null, chave extra, nao-objeto);
 * - 409 quando o cliente avanca a partir de um `expectedSequenceNumber` desatualizado
 *   (guarda otimista por sequence_number no repositorio).
 *
 * DB/auth setup espelha tests/unit/agentSkills-routes.test.ts: DATA_DIR temporario e
 * sem senha configurada => requireManagementAuth e no-op; INITIAL_PASSWORD liga a auth.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// ── DB / auth / flag setup ───────────────────────────────────────────────────

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-loop-api-routes-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const ORIGINAL_API_KEY_SECRET = process.env.API_KEY_SECRET;
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
const ORIGINAL_LOOP_FLAG = process.env.LOOP_ENGINE_ENABLED;

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET ?? "loop-api-routes-test-secret";
delete process.env.INITIAL_PASSWORD;

// DB primeiro (fixa DATA_DIR antes do singleton carregar), rotas depois.
const core = await import("../../src/lib/db/core.ts");
const loopRoute = await import("../../src/app/api/loop/route.ts");
const loopByIdRoute = await import("../../src/app/api/loop/[id]/route.ts");
const advanceRoute = await import("../../src/app/api/loop/[id]/advance/route.ts");
const approveRoute = await import("../../src/app/api/loop/[id]/approve/route.ts");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

type ErrorBody = { error: { message: string; type: string } };
type RunsBody = { runs: unknown[] };

async function listRuns(): Promise<unknown[]> {
  const res = await loopRoute.GET(makeRequest("GET", "http://localhost/api/loop"));
  assert.equal(res.status, 200);
  return ((await res.json()) as RunsBody).runs;
}

async function startRun(pattern: string): Promise<{ id: string; sequenceNumber: number }> {
  const res = await loopRoute.POST(makeRequest("POST", "http://localhost/api/loop", { pattern }));
  assert.equal(res.status, 201, `start run: esperado 201, veio ${res.status}`);
  const body = (await res.json()) as { run: { id: string; sequenceNumber: number } };
  return body.run;
}

async function advance(id: string, body?: unknown): Promise<Response> {
  return advanceRoute.POST(makeRequest("POST", `http://localhost/api/loop/${id}/advance`, body), {
    params: Promise.resolve({ id }),
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * DB limpo por teste: INITIAL_PASSWORD e persistido nas settings no primeiro getSettings(),
 * entao um teste de auth contaminaria os seguintes se o storage fosse compartilhado.
 */
function resetStorage(): void {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.INITIAL_PASSWORD;
  process.env.LOOP_ENGINE_ENABLED = "true";
}

test.beforeEach(() => {
  resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_API_KEY_SECRET === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = ORIGINAL_API_KEY_SECRET;
  if (ORIGINAL_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL_PASSWORD;
  if (ORIGINAL_LOOP_FLAG === undefined) delete process.env.LOOP_ENGINE_ENABLED;
  else process.env.LOOP_ENGINE_ENABLED = ORIGINAL_LOOP_FLAG;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

test("GET/POST /api/loop — 401/403 sem credencial quando o login e obrigatorio", async () => {
  process.env.INITIAL_PASSWORD = "loop-routes-require-login";
  for (const req of [
    makeRequest("GET", "http://localhost/api/loop"),
    makeRequest("POST", "http://localhost/api/loop", { pattern: "daily-triage" }),
  ]) {
    const res = await (req.method === "GET" ? loopRoute.GET(req) : loopRoute.POST(req));
    assert.ok(
      res.status === 401 || res.status === 403,
      `${req.method}: esperado 401/403 sem auth, veio ${res.status}`
    );
    const body = (await res.json()) as ErrorBody;
    assert.equal(typeof body.error.message, "string");
    assert.ok(!body.error.message.includes("at /"), "sem stack trace no erro");
  }
});

test("POST /api/loop/[id]/advance — auth vem ANTES do gate da flag (401/403, nao 404)", async () => {
  process.env.INITIAL_PASSWORD = "loop-routes-require-login";
  delete process.env.LOOP_ENGINE_ENABLED;
  const res = await advance("does-not-matter");
  assert.ok(res.status === 401 || res.status === 403, `esperado 401/403, veio ${res.status}`);
});

// ── Feature flag ─────────────────────────────────────────────────────────────

test("flag LOOP_ENGINE_ENABLED desligada (default) -> 404 em GET/POST /api/loop e no advance", async () => {
  delete process.env.LOOP_ENGINE_ENABLED;
  const get = await loopRoute.GET(makeRequest("GET", "http://localhost/api/loop"));
  assert.equal(get.status, 404);
  const post = await loopRoute.POST(
    makeRequest("POST", "http://localhost/api/loop", { pattern: "daily-triage" })
  );
  assert.equal(post.status, 404);
  const adv = await advance("any");
  assert.equal(adv.status, 404);
  const body = (await post.json()) as ErrorBody;
  assert.match(body.error.message, /LOOP_ENGINE_ENABLED/);
});

// ── Validacao do budget (M1) ─────────────────────────────────────────────────

const INVALID_BUDGETS: Array<{ label: string; budget: unknown }> = [
  { label: 'maxTokens:"x"', budget: { maxTokens: "x" } },
  { label: "maxTokens:-1", budget: { maxTokens: -1 } },
  { label: "maxTokens:0", budget: { maxTokens: 0 } },
  { label: "maxTokens:NaN (vira null no JSON)", budget: { maxTokens: NaN } },
  { label: "maxWallClockMs:'60000' (string numerica)", budget: { maxWallClockMs: "60000" } },
  { label: "maxAttempts:1.5 (nao inteiro)", budget: { maxAttempts: 1.5 } },
  { label: "chave extra", budget: { maxTokens: 10, foo: 1 } },
  { label: "budget nao-objeto (string)", budget: "abc" },
  { label: "budget nao-objeto (array)", budget: [1, 2, 3] },
  { label: "budget null", budget: null },
];

for (const { label, budget } of INVALID_BUDGETS) {
  test(`POST /api/loop — budget invalido (${label}) -> 400 e nada e criado`, async () => {
    const before = await listRuns();
    const res = await loopRoute.POST(
      makeRequest("POST", "http://localhost/api/loop", { pattern: "p", budget })
    );
    assert.equal(res.status, 400, `${label}: esperado 400, veio ${res.status}`);
    const body = (await res.json()) as ErrorBody;
    assert.equal(body.error.type, "invalid_request");
    assert.match(body.error.message, /budget/i);
    const after = await listRuns();
    assert.equal(after.length, before.length, "um budget invalido nao pode criar run");
  });
}

test("POST /api/loop — budget valido (parcial) e aceito e mesclado com os defaults", async () => {
  const res = await loopRoute.POST(
    makeRequest("POST", "http://localhost/api/loop", {
      pattern: "daily-triage",
      budget: { maxTokens: 123, maxAttempts: 2 },
    })
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    run: { budget: { maxTokens: number; maxWallClockMs: number; maxAttempts: number } };
  };
  assert.equal(body.run.budget.maxTokens, 123);
  assert.equal(body.run.budget.maxAttempts, 2);
  assert.ok(body.run.budget.maxWallClockMs > 0, "default de maxWallClockMs preservado");
});

test("POST /api/loop — sem pattern -> 400 no envelope padrao", async () => {
  const res = await loopRoute.POST(makeRequest("POST", "http://localhost/api/loop", {}));
  assert.equal(res.status, 400);
  const body = (await res.json()) as ErrorBody;
  assert.equal(body.error.type, "invalid_request");
});

// ── Concorrencia otimista (M2) ───────────────────────────────────────────────

test("POST /api/loop/[id]/advance — expectedSequenceNumber desatualizado -> 409 e o run nao muda", async () => {
  const run = await startRun("pr-babysitter");
  assert.equal(run.sequenceNumber, 0);

  const ok = await advance(run.id, { expectedSequenceNumber: 0 });
  assert.equal(ok.status, 200);
  const first = (await ok.json()) as { run: { sequenceNumber: number; phase: string } };
  assert.equal(first.run.sequenceNumber, 1);
  assert.equal(first.run.phase, "plan");

  // segundo escritor partindo do mesmo snapshot (sequence 0)
  const stale = await advance(run.id, { expectedSequenceNumber: 0 });
  assert.equal(stale.status, 409, `esperado 409, veio ${stale.status}`);
  const body = (await stale.json()) as ErrorBody;
  assert.equal(body.error.type, "conflict");

  const get = await loopByIdRoute.GET(makeRequest("GET", `http://localhost/api/loop/${run.id}`), {
    params: Promise.resolve({ id: run.id }),
  });
  const current = (await get.json()) as { run: { sequenceNumber: number; phase: string } };
  assert.equal(current.run.sequenceNumber, 1, "o escritor desatualizado nao pode gravar");
  assert.equal(current.run.phase, "plan");
});

test("POST /api/loop/[id]/advance — expectedSequenceNumber/consumed invalidos -> 400", async () => {
  const run = await startRun("validate-advance");
  for (const body of [
    { expectedSequenceNumber: "0" },
    { expectedSequenceNumber: -1 },
    { consumed: { tokens: "x" } },
    { consumed: { tokens: -5 } },
    { consumed: { extra: 1 } },
  ]) {
    const res = await advance(run.id, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)}: esperado 400, veio ${res.status}`);
  }
});

test("POST /api/loop/[id]/advance — run inexistente -> 404 no envelope padrao", async () => {
  const res = await advance("00000000-0000-4000-8000-000000000000");
  assert.equal(res.status, 404);
  const body = (await res.json()) as ErrorBody;
  assert.equal(body.error.type, "not_found");
});

// ── Validacao de entrada (B-H2) ──────────────────────────────────────────────

const INVALID_START_BODIES: Array<{ label: string; body: unknown }> = [
  { label: "pattern > 128", body: { pattern: "a".repeat(129) } },
  { label: "pattern com espaco", body: { pattern: "daily triage" } },
  { label: "pattern com caractere fora de [A-Za-z0-9._-]", body: { pattern: "rm;-rf" } },
  { label: "taskId > 64", body: { pattern: "p", taskId: "t".repeat(65) } },
  { label: "taskId nao-string", body: { pattern: "p", taskId: 42 } },
  { label: "correlationId > 64", body: { pattern: "p", correlationId: "c".repeat(65) } },
  { label: "budget.maxTokens acima do teto", body: { pattern: "p", budget: { maxTokens: 1e12 } } },
  {
    label: "budget.maxAttempts acima do teto",
    body: { pattern: "p", budget: { maxAttempts: 10_000 } },
  },
];

for (const { label, body } of INVALID_START_BODIES) {
  test(`POST /api/loop — entrada invalida (${label}) -> 400`, async () => {
    const res = await loopRoute.POST(makeRequest("POST", "http://localhost/api/loop", body));
    assert.equal(res.status, 400, `${label}: esperado 400, veio ${res.status}`);
    const err = (await res.json()) as ErrorBody;
    assert.equal(err.error.type, "invalid_request");
  });
}

test("POST /api/loop — pattern com 128 chars validos, taskId/correlationId com 64 -> 201", async () => {
  const res = await loopRoute.POST(
    makeRequest("POST", "http://localhost/api/loop", {
      pattern: "A-z.0_9".padEnd(128, "x"),
      taskId: "t".repeat(64),
      correlationId: "c".repeat(64),
    })
  );
  assert.equal(res.status, 201);
});

async function approve(id: string, body?: unknown): Promise<Response> {
  return approveRoute.POST(makeRequest("POST", `http://localhost/api/loop/${id}/approve`, body), {
    params: Promise.resolve({ id }),
  });
}

async function addStepViaRunner(runId: string, kind: "git_pr" | "purchase"): Promise<string> {
  const runner = await import("../../src/lib/loopRunner.ts");
  const run = runner.addStep(runId, { title: kind, proposedEffect: { kind, summary: kind } });
  return run.steps[run.steps.length - 1].id;
}

test("POST /api/loop/[id]/approve — body invalido -> 400 (stepId ausente, decision fora do enum)", async () => {
  const run = await startRun("approve-validate");
  for (const body of [{}, { stepId: "" }, { stepId: "x", decision: "maybe" }, { stepId: 12 }]) {
    const res = await approve(run.id, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)}: esperado 400, veio ${res.status}`);
  }
});

test("POST /api/loop/[id]/approve — run fora de awaiting_approval -> 409 (estado), etapa intacta", async () => {
  const run = await startRun("approve-state");
  const stepId = await addStepViaRunner(run.id, "git_pr");
  const res = await approve(run.id, { stepId, decision: "approve" });
  assert.equal(res.status, 409, `esperado 409, veio ${res.status}`);
  const err = (await res.json()) as ErrorBody;
  assert.equal(err.error.type, "conflict");
});

test("POST /api/loop/[id]/approve — efeito destrutivo (purchase) -> 409 mesmo aguardando aprovacao", async () => {
  const run = await startRun("approve-deny");
  await addStepViaRunner(run.id, "git_pr");
  for (let i = 0; i < 4; i += 1) await advance(run.id); // discover->plan->split->execute->gate
  const purchaseId = await addStepViaRunner(run.id, "purchase");
  const res = await approve(run.id, { stepId: purchaseId, decision: "approve" });
  assert.equal(res.status, 409, `esperado 409, veio ${res.status}`);
  const get = await loopByIdRoute.GET(makeRequest("GET", `http://localhost/api/loop/${run.id}`), {
    params: Promise.resolve({ id: run.id }),
  });
  const current = (await get.json()) as {
    run: { status: string; steps: Array<{ status: string }> };
  };
  assert.equal(current.run.status, "awaiting_approval");
  assert.equal(current.run.steps[1].status, "proposed");
});

test("POST /api/loop/[id]/approve — etapa inexistente -> 404 no envelope padrao", async () => {
  const run = await startRun("approve-404");
  const res = await approve(run.id, { stepId: "nope", decision: "approve" });
  assert.equal(res.status, 404);
  const err = (await res.json()) as ErrorBody;
  assert.equal(err.error.type, "not_found");
});
