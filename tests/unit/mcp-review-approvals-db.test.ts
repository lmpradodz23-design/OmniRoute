import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-mcp-approvals-db-"));
process.env.DATA_DIR = DATA_DIR;

const { getDbInstance } = await import("../../src/lib/db/core.ts");
const store = await import("../../src/lib/db/mcpReviewApprovals.ts");

function ensureSchema(): void {
  const dir = path.join(process.cwd(), "src/lib/db/migrations");
  const file = fs.readdirSync(dir).find((f) => f.endsWith("_mcp_review_approvals.sql"));
  assert.ok(file, "mcp review approvals migration not found in src/lib/db/migrations");
  getDbInstance().exec(fs.readFileSync(path.join(dir, file), "utf8"));
}

test("mcp approvals db: sem aprovação -> null", () => {
  ensureSchema();
  assert.equal(store.getActiveMcpReviewApproval("never", "reg"), null);
});

test("mcp approvals db: record grava normalizado (trim, lowercase, dedup, ordenado) e get devolve", () => {
  ensureSchema();
  const recorded = store.recordMcpReviewApproval(
    {
      name: "norm",
      source: "reg",
      version: "1.0.0",
      permissions: ["NET:Fetch", " fs:read ", "net:fetch"],
      publisherVerified: true,
    },
    "dashboard_session:dashboard"
  );
  assert.deepEqual(recorded.permissions, ["fs:read", "net:fetch"]);

  const got = store.getActiveMcpReviewApproval("norm", "reg");
  assert.ok(got);
  assert.deepEqual(got.permissions, ["fs:read", "net:fetch"]);
  assert.equal(got.version, "1.0.0");
  assert.equal(got.publisherVerified, true);
  assert.equal(got.approvedBy, "dashboard_session:dashboard");
  assert.ok(!Number.isNaN(Date.parse(got.approvedAt)));

  const raw = getDbInstance()
    .prepare("SELECT permissions_json FROM mcp_review_approvals WHERE name = ? AND source = ?")
    .get("norm", "reg") as { permissions_json: string };
  assert.equal(raw.permissions_json, '["fs:read","net:fetch"]');
});

test("mcp approvals db: chave é (name, source) — mesma name em outra source não herda", () => {
  ensureSchema();
  store.recordMcpReviewApproval(
    { name: "same", source: "reg-a", version: "1.0.0", permissions: ["net:fetch"] },
    "t"
  );
  assert.ok(store.getActiveMcpReviewApproval("same", "reg-a"));
  assert.equal(store.getActiveMcpReviewApproval("same", "reg-b"), null);
});

test("mcp approvals db: escopo por tenant — aprovação de um tenant é invisível e irrevogável no outro", () => {
  ensureSchema();
  store.recordMcpReviewApproval(
    { name: "tenanted", source: "reg", version: "1.0.0", permissions: ["net:fetch"] },
    "t",
    "tenant-a"
  );
  assert.ok(store.getActiveMcpReviewApproval("tenanted", "reg", "tenant-a"));
  assert.equal(store.getActiveMcpReviewApproval("tenanted", "reg", "tenant-b"), null);
  assert.equal(store.getActiveMcpReviewApproval("tenanted", "reg"), null, "default tenant");
  assert.equal(store.revokeMcpReviewApproval("tenanted", "reg", "t", "tenant-b"), false);
  assert.ok(store.getActiveMcpReviewApproval("tenanted", "reg", "tenant-a"));
});

test("mcp approvals db: revoke esconde a aprovação, não apaga a linha, e reaprovar limpa a revogação", () => {
  ensureSchema();
  store.recordMcpReviewApproval(
    { name: "rev", source: "reg", version: "1.0.0", permissions: ["net:fetch"] },
    "first"
  );
  assert.equal(store.revokeMcpReviewApproval("rev", "reg", "revoker"), true);
  assert.equal(store.getActiveMcpReviewApproval("rev", "reg"), null);
  assert.equal(store.revokeMcpReviewApproval("rev", "reg", "revoker"), false, "já revogada");

  const row = getDbInstance()
    .prepare(
      "SELECT revoked_at, revoked_by FROM mcp_review_approvals WHERE name = ? AND source = ?"
    )
    .get("rev", "reg") as { revoked_at: string | null; revoked_by: string | null };
  assert.ok(row.revoked_at);
  assert.equal(row.revoked_by, "revoker");

  store.recordMcpReviewApproval(
    { name: "rev", source: "reg", version: "2.0.0", permissions: ["fs:read"] },
    "second"
  );
  const again = store.getActiveMcpReviewApproval("rev", "reg");
  assert.ok(again);
  assert.equal(again.version, "2.0.0");
  assert.deepEqual(again.permissions, ["fs:read"]);
  assert.equal(again.approvedBy, "second");
  const count = getDbInstance()
    .prepare("SELECT COUNT(*) AS n FROM mcp_review_approvals WHERE name = ? AND source = ?")
    .get("rev", "reg") as { n: number };
  assert.equal(count.n, 1, "uma linha corrente por (tenant, name, source)");
});

test("mcp approvals db: publisherVerified ausente grava false", () => {
  ensureSchema();
  const a = store.recordMcpReviewApproval(
    { name: "nopub", source: "reg", version: "1.0.0", permissions: [] },
    "t"
  );
  assert.equal(a.publisherVerified, false);
  assert.equal(store.getActiveMcpReviewApproval("nopub", "reg")?.publisherVerified, false);
});
