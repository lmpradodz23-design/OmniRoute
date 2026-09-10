// ENVIRONMENT NOTE (sandbox better-sqlite3 / glibc limitation, not a code defect):
// This suite drives a real on-disk database through core.getDbInstance(); see
// tests/unit/_helpers/betterSqlite3Availability.ts.
//
// R-2 (audit/02-ARCHITECTURE.md): several operations issue N dependent writes without a
// transaction, so a crash or a failing statement in the middle leaves the database
// half-mutated (a deleted key whose budgets survive, a provider whose priorities are half
// renumbered, an issued key whose issuance was never counted). Faults are injected with
// SQLite triggers that RAISE(ABORT) on the SECOND write of each sequence — the exact point
// where partial state would leak — so the test exercises the real adapter transaction
// path instead of mocks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r2-atomic-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.API_KEY_SECRET = "test-secret-r2";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const registeredKeysDb = await import("../../src/lib/db/registeredKeys.ts");
const deletion = await import("../../src/lib/db/providers/deletion.ts");

type Row = Record<string, unknown>;

function db() {
  return core.getDbInstance();
}

function withAbortTrigger<T>(name: string, body: string, fn: () => T): T {
  db().exec(`CREATE TRIGGER ${name} ${body} BEGIN SELECT RAISE(ABORT, 'r2-fault'); END;`);
  try {
    return fn();
  } finally {
    db().exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

async function withAbortTriggerAsync<T>(name: string, body: string, fn: () => Promise<T>) {
  db().exec(`CREATE TRIGGER ${name} ${body} BEGIN SELECT RAISE(ABORT, 'r2-fault'); END;`);
  try {
    return await fn();
  } finally {
    db().exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("deleteApiKey removes the key, its budget and its cost history atomically", async () => {
  const created = await apiKeysDb.createApiKey("r2-delete", "machine-r2");
  db()
    .prepare("INSERT INTO domain_budgets (api_key_id, daily_limit_usd) VALUES (?, ?)")
    .run(created.id, 10);
  db()
    .prepare("INSERT INTO domain_cost_history (api_key_id, cost, timestamp) VALUES (?, ?, ?)")
    .run(created.id, 0.5, Date.now());

  // Fault on the SECOND write (domain_budgets): the api_keys row was already deleted.
  await withAbortTriggerAsync("r2_budget_fault", "BEFORE DELETE ON domain_budgets", () =>
    assert.rejects(apiKeysDb.deleteApiKey(created.id), /r2-fault/)
  );

  const key = db().prepare("SELECT id FROM api_keys WHERE id = ?").get(created.id) as
    Row | undefined;
  assert.ok(key, "a failed multi-write delete must leave the api_keys row in place");
  const budget = db()
    .prepare("SELECT api_key_id FROM domain_budgets WHERE api_key_id = ?")
    .get(created.id);
  assert.ok(budget, "budget untouched after the aborted delete");

  // Without the fault the whole sequence lands.
  assert.equal(await apiKeysDb.deleteApiKey(created.id), true);
  for (const table of ["api_keys", "domain_budgets", "domain_cost_history"]) {
    const column = table === "api_keys" ? "id" : "api_key_id";
    const left = db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
      .get(created.id) as { n: number };
    assert.equal(left.n, 0, `${table} cleaned up by the successful delete`);
  }
});

test("reorderConnections renumbers a provider's priorities all-or-nothing", () => {
  const now = new Date().toISOString();
  const insert = db().prepare(
    "INSERT INTO provider_connections (id, provider, auth_type, name, is_active, priority, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
  );
  insert.run("r2-c1", "r2prov", "apikey", "c1", 5, now, now);
  insert.run("r2-c2", "r2prov", "apikey", "c2", 7, now, now);
  insert.run("r2-c3", "r2prov", "apikey", "c3", 9, now, now);
  const priorities = () =>
    (
      db()
        .prepare("SELECT priority FROM provider_connections WHERE provider = ? ORDER BY id")
        .all("r2prov") as Array<{ priority: number }>
    ).map((row) => row.priority);

  // Fault on the SECOND renumbered row (priority 2): row one was already set to 1.
  withAbortTrigger(
    "r2_reorder_fault",
    "BEFORE UPDATE OF priority ON provider_connections WHEN NEW.priority = 2",
    () => assert.throws(() => deletion.reorderConnections(db() as never, "r2prov"), /r2-fault/)
  );
  assert.deepEqual(priorities(), [5, 7, 9], "no priority may change when the renumbering aborts");

  deletion.reorderConnections(db() as never, "r2prov");
  assert.deepEqual(priorities(), [1, 2, 3]);
});

test("issueRegisteredKey never persists a key whose issuance was not counted", () => {
  // Fault on the SECOND write (provider_key_limits): the registered_keys row already exists.
  withAbortTrigger("r2_issuance_fault", "BEFORE INSERT ON provider_key_limits", () =>
    assert.throws(
      () => registeredKeysDb.issueRegisteredKey({ name: "r2-key", provider: "r2prov" }),
      /r2-fault/
    )
  );
  const orphaned = db()
    .prepare("SELECT COUNT(*) AS n FROM registered_keys WHERE name = ?")
    .get("r2-key") as { n: number };
  assert.equal(orphaned.n, 0, "an uncounted key must not exist after the aborted issuance");

  const issued = registeredKeysDb.issueRegisteredKey({ name: "r2-key", provider: "r2prov" });
  assert.ok("id" in issued, "issuance succeeds without the fault");
  const counted = db()
    .prepare("SELECT daily_issued FROM provider_key_limits WHERE provider = ?")
    .get("r2prov") as { daily_issued: number };
  assert.equal(counted.daily_issued, 1);
});
