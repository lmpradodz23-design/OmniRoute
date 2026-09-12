import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-mcp-approvals-ep-"));
process.env.DATA_DIR = DATA_DIR;

const { getDbInstance } = await import("../../src/lib/db/core.ts");
const flags = await import("../../src/lib/db/featureFlags.ts");
const review = await import("../../src/app/api/mcp/review/route.ts");
const approve = await import("../../src/app/api/mcp/review/approve/route.ts");
const revoke = await import("../../src/app/api/mcp/review/revoke/route.ts");

function ensureSchema(): void {
  const dir = path.join(process.cwd(), "src/lib/db/migrations");
  const file = fs.readdirSync(dir).find((f) => f.endsWith("_mcp_review_approvals.sql"));
  assert.ok(file, "mcp review approvals migration not found in src/lib/db/migrations");
  getDbInstance().exec(fs.readFileSync(path.join(dir, file), "utf8"));
  flags.setFeatureFlagOverride("MCP_REVIEW_ENABLED", "true");
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

type Handler = (req: never) => Promise<Response>;
type Verdict = { state: string; requiresHumanApproval: boolean; newlyRequested: string[] };

function call(handler: Handler, route: string, body: unknown, headers?: Record<string, string>) {
  return handler(post(`http://localhost/api/mcp/review${route}`, body, headers) as never);
}

async function reviewVerdict(candidate: Record<string, unknown>): Promise<Verdict> {
  const res = await call(review.POST as Handler, "", { candidate });
  assert.equal(res.status, 200);
  return ((await res.json()) as { verdict: Verdict }).verdict;
}

const base = {
  name: "weather-mcp",
  source: "registry.example/weather",
  version: "1.0.0",
  permissions: ["net:fetch", "fs:read"],
  publisherVerified: true,
};

test("ciclo: novo -> review_required; aprovar -> approved; ampliar -> review_required; revogar -> review_required", async () => {
  ensureSchema();
  assert.equal((await reviewVerdict(base)).state, "review_required", "nunca aprovado");

  const ap = await call(approve.POST as Handler, "/approve", { candidate: base });
  assert.equal(ap.status, 201);
  const apBody = (await ap.json()) as {
    approval: { permissions: string[]; approvedBy: string };
    verdict: Verdict;
  };
  assert.deepEqual(apBody.approval.permissions, ["fs:read", "net:fetch"]);
  assert.equal(apBody.approval.approvedBy, "management:unattributed");
  assert.equal(apBody.verdict.state, "approved");

  // mesma name+source, mesmas permissões (outra caixa/ordem), publisher verificado
  const same = await reviewVerdict({
    ...base,
    version: "1.0.1",
    permissions: ["FS:READ", "net:fetch"],
  });
  assert.equal(same.state, "approved");
  assert.equal(same.requiresHumanApproval, false);

  const broadened = await reviewVerdict({
    ...base,
    permissions: [...base.permissions, "shell:exec"],
  });
  assert.equal(broadened.state, "review_required");
  assert.deepEqual(broadened.newlyRequested, ["shell:exec"]);

  // outra source com a mesma name não herda a aprovação
  const otherSource = await reviewVerdict({ ...base, source: "evil.example/weather" });
  assert.equal(otherSource.state, "review_required");

  // publisher ausente não carrega a aprovação (fail-closed do motor)
  const unverified = { ...base, publisherVerified: undefined };
  assert.equal((await reviewVerdict(unverified)).state, "review_required");

  const rv = await call(revoke.POST as Handler, "/revoke", {
    name: base.name,
    source: base.source,
  });
  assert.equal(rv.status, 200);
  assert.deepEqual(await rv.json(), { revoked: true, name: base.name, source: base.source });
  assert.equal((await reviewVerdict(base)).state, "review_required", "revogado");

  const again = await call(revoke.POST as Handler, "/revoke", {
    name: base.name,
    source: base.source,
  });
  assert.equal(again.status, 404);
  const againBody = (await again.json()) as { error: { details: { code: string } } };
  assert.equal(againBody.error.details.code, "MCP_APPROVAL_NOT_FOUND");
});

test("approve: permissão proibida (KEYS:READ) -> 422 MCP_REVIEW_DENIED e nada é gravado", async () => {
  ensureSchema();
  const candidate = { ...base, name: "greedy-mcp", permissions: ["net:fetch", "KEYS:READ"] };
  const res = await call(approve.POST as Handler, "/approve", { candidate });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: { details: { code: string } } };
  assert.equal(body.error.details.code, "MCP_REVIEW_DENIED");
  assert.equal((await reviewVerdict(candidate)).state, "denied");
  const row = getDbInstance()
    .prepare("SELECT COUNT(*) AS n FROM mcp_review_approvals WHERE name = ?")
    .get("greedy-mcp") as { n: number };
  assert.equal(row.n, 0);
});

test("approve: flaggedMalicious -> 422", async () => {
  ensureSchema();
  const candidate = { ...base, name: "evil-mcp", flaggedMalicious: true };
  const res = await call(approve.POST as Handler, "/approve", { candidate });
  assert.equal(res.status, 422);
});

test("approve: aprovação existente não libera permissão proibida acrescentada depois", async () => {
  ensureSchema();
  const c = { ...base, name: "later-greedy" };
  assert.equal((await call(approve.POST as Handler, "/approve", { candidate: c })).status, 201);
  const v = await reviewVerdict({ ...c, permissions: [...c.permissions, "secrets:exfiltrate"] });
  assert.equal(v.state, "denied");
});

test("approve: approved_by vem do sujeito carimbado pelo pipeline de authz", async () => {
  ensureSchema();
  const c = { ...base, name: "attributed-mcp" };
  const res = await call(
    approve.POST as Handler,
    "/approve",
    { candidate: c },
    { "x-omniroute-auth-kind": "dashboard_session", "x-omniroute-auth-id": "dashboard" }
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { approval: { approvedBy: string } };
  assert.equal(body.approval.approvedBy, "dashboard_session:dashboard");
});

test("flag OFF -> 404 em approve e revoke", async () => {
  ensureSchema();
  flags.setFeatureFlagOverride("MCP_REVIEW_ENABLED", "false");
  try {
    assert.equal(
      (await call(approve.POST as Handler, "/approve", { candidate: base })).status,
      404
    );
    const rv = await call(revoke.POST as Handler, "/revoke", {
      name: base.name,
      source: base.source,
    });
    assert.equal(rv.status, 404);
  } finally {
    flags.setFeatureFlagOverride("MCP_REVIEW_ENABLED", "true");
  }
});

test("corpo inválido -> 400 (prior no corpo, chave desconhecida, campos faltando, fora do limite)", async () => {
  ensureSchema();
  const cases: Array<[Handler, string, unknown]> = [
    [approve.POST as Handler, "/approve", { candidate: base, prior: { approved: true } }],
    [approve.POST as Handler, "/approve", { candidate: { ...base, extra: 1 } }],
    [approve.POST as Handler, "/approve", { candidate: { name: "x" } }],
    [approve.POST as Handler, "/approve", { candidate: { ...base, permissions: ["bad perm"] } }],
    [approve.POST as Handler, "/approve", {}],
    [revoke.POST as Handler, "/revoke", { name: base.name }],
    [revoke.POST as Handler, "/revoke", { name: base.name, source: base.source, extra: true }],
    [revoke.POST as Handler, "/revoke", { name: "", source: base.source }],
    [revoke.POST as Handler, "/revoke", { name: "x".repeat(201), source: base.source }],
  ];
  for (const [handler, route, body] of cases) {
    const res = await call(handler, route, body);
    assert.equal(res.status, 400, `${route} ${JSON.stringify(body).slice(0, 80)}`);
  }
  const notJson = await approve.POST(
    new Request("http://localhost/api/mcp/review/approve", { method: "POST", body: "{" }) as never
  );
  assert.equal(notJson.status, 400);
});
