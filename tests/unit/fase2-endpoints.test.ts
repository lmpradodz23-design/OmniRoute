import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fase2-ep-"));
process.env.DATA_DIR = DATA_DIR;

const { getDbInstance } = await import("../../src/lib/db/core.ts");
const flags = await import("../../src/lib/db/featureFlags.ts");
const mcpReview = await import("../../src/app/api/mcp/review/route.ts");
const browserCheck = await import("../../src/app/api/browser/check/route.ts");
const otelSpans = await import("../../src/app/api/otel/spans/route.ts");
const loopStream = await import("../../src/app/api/loop/[id]/stream/route.ts");
const loopRunner = await import("../../src/lib/loopRunner.ts");

function ensureSchema(): void {
  // Resolved by name, not by ordinal. This test used to hardcode
  // `174_loop_engine_and_buzz_bridge.sql` and broke the moment the migration was
  // renumbered to 175 on the release line — a rename that says nothing about the
  // schema it creates. The suffix is the stable part.
  const dir = path.join(process.cwd(), "src/lib/db/migrations");
  const file = fs.readdirSync(dir).find((f) => f.endsWith("_loop_engine_and_buzz_bridge.sql"));
  assert.ok(file, "loop engine / buzz bridge migration not found in src/lib/db/migrations");
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  getDbInstance().exec(sql);
  // The review route now reads prior approvals from this table; resolved by suffix too.
  const approvals = fs.readdirSync(dir).find((f) => f.endsWith("_mcp_review_approvals.sql"));
  assert.ok(approvals, "mcp review approvals migration not found in src/lib/db/migrations");
  getDbInstance().exec(fs.readFileSync(path.join(dir, approvals), "utf8"));
  getDbInstance().exec(
    "CREATE TABLE IF NOT EXISTS key_value (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY(namespace,key))"
  );
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/mcp/review: flag OFF -> 404; flag ON -> verdict review_required", async () => {
  ensureSchema();
  flags.setFeatureFlagOverride("MCP_REVIEW_ENABLED", "false");
  const off = await mcpReview.POST(
    post("http://localhost/api/mcp/review", {
      candidate: { name: "x", source: "reg", version: "1.0.0", permissions: ["net:fetch"] },
    })
  );
  assert.equal(off.status, 404);

  flags.setFeatureFlagOverride("MCP_REVIEW_ENABLED", "true");
  const on = await mcpReview.POST(
    post("http://localhost/api/mcp/review", {
      candidate: { name: "x", source: "reg", version: "1.0.0", permissions: ["net:fetch"] },
    })
  );
  assert.equal(on.status, 200);
  const body = (await on.json()) as { verdict: { state: string; requiresHumanApproval: boolean } };
  assert.equal(body.verdict.state, "review_required");
  assert.equal(body.verdict.requiresHumanApproval, true);
});

test("POST /api/browser/check: efeito externo originado na página -> deny", async () => {
  ensureSchema();
  flags.setFeatureFlagOverride("BROWSER_USE_ENABLED", "true");
  const res = await browserCheck.POST(
    post("http://localhost/api/browser/check", {
      action: { kind: "purchase", url: "https://example.com/buy", origin: "page" },
      allowedDomains: ["example.com"],
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { verdict: { decision: string } };
  assert.equal(body.verdict.decision, "deny");
});

test("GET /api/otel/spans: coleta o span de uma chamada tratada (mcp.review)", async () => {
  ensureSchema();
  flags.setFeatureFlagOverride("OTEL_TRACING_ENABLED", "true");
  flags.setFeatureFlagOverride("MCP_REVIEW_ENABLED", "true");
  // dispara uma chamada que emite span
  await mcpReview.POST(
    post("http://localhost/api/mcp/review", {
      candidate: { name: "traced", source: "reg", version: "1.0.0", permissions: ["net:fetch"] },
    })
  );
  const res = await otelSpans.GET(new Request("http://localhost/api/otel/spans"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    spans: Array<{ name: string; attributes: Record<string, unknown> }>;
  };
  const span = body.spans.find((s) => s.name === "mcp.review");
  assert.ok(span, "deve haver um span mcp.review");
  // sem conteúdo sensível: só chaves allowlisted
  assert.equal("prompt" in span!.attributes, false);
  assert.equal(span!.attributes.route, "/api/mcp/review");
});

test("GET /api/loop/[id]/stream: emite fluxo AG-UI (RUN_STARTED..RUN_FINISHED)", async () => {
  ensureSchema();
  flags.setFeatureFlagOverride("LOOP_ENGINE_ENABLED", "true");
  const run = loopRunner.startRun({ pattern: "demo-stream" });
  loopRunner.addStep(run.id, { title: "revisar issues" });

  const res = await loopStream.GET(new Request(`http://localhost/api/loop/${run.id}/stream`), {
    params: Promise.resolve({ id: run.id }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") || "", /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /event: RUN_STARTED/);
  assert.match(text, /revisar issues/);
  assert.match(text, /event: RUN_FINISHED/);
});
