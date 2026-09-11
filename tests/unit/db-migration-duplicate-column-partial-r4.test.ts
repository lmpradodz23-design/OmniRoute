// ENVIRONMENT NOTE (sandbox better-sqlite3 / glibc limitation, not a code defect):
// This suite drives a real on-disk database through core.getDbInstance(); see
// tests/unit/_helpers/betterSqlite3Availability.ts.
//
// R-4 (audit/02-ARCHITECTURE.md): when a migration failed with "duplicate column name"
// the runner swallowed the failure and recorded the migration as applied, on the
// assumption that the whole file had already been applied by hand. A file that adds TWO
// columns where only the first pre-exists is genuinely partial — the second ALTER never
// ran — yet it was marked applied and the missing column surfaced later as "no such
// column" at request time. Tolerance is now conditional on the final state: every column
// the file adds must exist; otherwise the migration fails like any other (restore point
// named), and nothing is recorded.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r4-dupcol-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");

const EXTRA_DIRS_ENV = "OMNIROUTE_EXTRA_MIGRATIONS_DIRS";

function hasColumn(table: string, column: string): boolean {
  const columns = core.getDbInstance().prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return columns.some((c) => c.name === column);
}

function ledgerHas(version: string): boolean {
  const row = core
    .getDbInstance()
    .prepare("SELECT version FROM _omniroute_migrations WHERE version = ?")
    .get(version);
  return Boolean(row);
}

test.after(() => {
  delete process.env[EXTRA_DIRS_ENV];
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a duplicate-column failure is NOT tolerated when the file's other columns are still missing", async () => {
  // Provision, then hand-apply only the FIRST column of the upcoming migration.
  core.getDbInstance().exec("ALTER TABLE key_value ADD COLUMN r4_first TEXT");
  core.resetDbInstance();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r4-mig-"));
  fs.writeFileSync(
    path.join(dir, "001_two_columns.sql"),
    "ALTER TABLE key_value ADD COLUMN r4_first TEXT;\n" +
      "ALTER TABLE key_value ADD COLUMN r4_second TEXT;\n"
  );
  process.env[EXTRA_DIRS_ENV] = `r4=${dir}`;

  let failure: Error | null = null;
  try {
    core.getDbInstance();
  } catch (error) {
    failure = error as Error;
  }
  delete process.env[EXTRA_DIRS_ENV];
  assert.ok(failure, "a partially applied migration must fail startup, not be marked applied");
  assert.match(failure.message, /duplicate column name/);
  assert.match(failure.message, /r4_second/, "the failure names the column still missing");

  core.getDbInstance();
  assert.equal(hasColumn("key_value", "r4_second"), false);
  assert.equal(ledgerHas("r4-001"), false, "nothing is recorded for the partial migration");
  core.resetDbInstance();
  fs.rmSync(dir, { recursive: true, force: true });
});

function hasIndex(name: string): boolean {
  const row = core
    .getDbInstance()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name);
  return Boolean(row);
}

test("a duplicate-column failure is NOT tolerated when the file's CREATE INDEX never ran (A-6)", async () => {
  // Final audit A-6: the probe only checked columns, so ADD COLUMN (pre-existing) followed
  // by CREATE INDEX was marked applied with the index missing.
  core.getDbInstance().exec("ALTER TABLE key_value ADD COLUMN r4_indexed TEXT");
  core.resetDbInstance();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r4-idx-"));
  fs.writeFileSync(
    path.join(dir, "001_column_and_index.sql"),
    "ALTER TABLE key_value ADD COLUMN r4_indexed TEXT;\n" +
      "CREATE INDEX IF NOT EXISTS idx_key_value_r4_indexed ON key_value(r4_indexed);\n"
  );
  process.env[EXTRA_DIRS_ENV] = `r4idx=${dir}`;

  let failure: Error | null = null;
  try {
    core.getDbInstance();
  } catch (error) {
    failure = error as Error;
  }
  delete process.env[EXTRA_DIRS_ENV];
  assert.ok(failure, "column present but index missing is partial, not applied");
  assert.match(
    failure.message,
    /index:idx_key_value_r4_indexed/,
    "the failure names the missing index"
  );

  core.getDbInstance();
  assert.equal(hasIndex("idx_key_value_r4_indexed"), false);
  assert.equal(ledgerHas("r4idx-001"), false, "nothing is recorded for the partial migration");
  core.resetDbInstance();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a duplicate-column failure IS tolerated when the file's column AND index already exist (A-6)", async () => {
  core.getDbInstance().exec("ALTER TABLE key_value ADD COLUMN r4_indexed_ok TEXT");
  core.getDbInstance().exec("CREATE INDEX idx_key_value_r4_indexed_ok ON key_value(r4_indexed_ok)");
  core.resetDbInstance();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r4-idx-ok-"));
  fs.writeFileSync(
    path.join(dir, "001_column_and_index_done.sql"),
    "ALTER TABLE key_value ADD COLUMN r4_indexed_ok TEXT;\n" +
      "CREATE INDEX IF NOT EXISTS idx_key_value_r4_indexed_ok ON key_value(r4_indexed_ok);\n"
  );
  process.env[EXTRA_DIRS_ENV] = `r4idxok=${dir}`;
  try {
    core.getDbInstance();
    assert.equal(
      ledgerHas("r4idxok-001"),
      true,
      "column + index pre-applied is recorded as applied"
    );
  } finally {
    delete process.env[EXTRA_DIRS_ENV];
    core.resetDbInstance();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a duplicate-column failure IS tolerated when every column the file adds already exists", async () => {
  core.getDbInstance().exec("ALTER TABLE key_value ADD COLUMN r4_done_a TEXT");
  core.getDbInstance().exec("ALTER TABLE key_value ADD COLUMN r4_done_b TEXT");
  core.resetDbInstance();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r4-mig-ok-"));
  fs.writeFileSync(
    path.join(dir, "001_already_there.sql"),
    "ALTER TABLE key_value ADD COLUMN r4_done_a TEXT;\n" +
      "ALTER TABLE key_value ADD COLUMN r4_done_b TEXT;\n"
  );
  process.env[EXTRA_DIRS_ENV] = `r4ok=${dir}`;
  try {
    core.getDbInstance();
    assert.equal(ledgerHas("r4ok-001"), true, "a fully pre-applied file is recorded as applied");
  } finally {
    delete process.env[EXTRA_DIRS_ENV];
    core.resetDbInstance();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
