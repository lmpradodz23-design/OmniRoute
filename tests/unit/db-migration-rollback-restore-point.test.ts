// ENVIRONMENT NOTE (sandbox better-sqlite3 / glibc limitation, not a code defect):
// This suite drives a real on-disk database through core.getDbInstance() because the
// rollback contract under test spans the migration runner's snapshot, the startup failure
// path and restoreDbBackup(). See tests/unit/_helpers/betterSqlite3Availability.ts.
//
// R-1 (audit/02-ARCHITECTURE.md): migrations have no down scripts, so "rollback" of a
// failed upgrade IS restoring the pre-migration snapshot. That only works if
//   1. the failure tells the operator which snapshot is the restore point,
//   2. the failed startup leaves the database file closed so the restore can replace it
//      (a leaked handle blocks unlink/copy on Windows and in the Electron host), and
//   3. restoring a content-addressed snapshot verifies the file against its own name, so a
//      swapped or truncated `db_state-<sha256>_pre-migration.sqlite` is refused even when
//      it is a structurally valid SQLite file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-rollback-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const backup = await import("../../src/lib/db/backup.ts");
const { hashFileSync } = await import("../../src/lib/db/migrationRunner/preMigrationBackup.ts");

const BACKUP_DIR = path.join(TEST_DATA_DIR, "db_backups");
const SNAPSHOT_ID = /db_state-([0-9a-f]{64})_pre-migration\.sqlite/;
const EXTRA_DIRS_ENV = "OMNIROUTE_EXTRA_MIGRATIONS_DIRS";

function listSnapshots(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((name) => SNAPSHOT_ID.test(name));
}

function readMarker(): string | undefined {
  const db = core.getDbInstance();
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("rollback-test", "marker") as { value?: string } | undefined;
  return row?.value;
}

function hasTable(name: string): boolean {
  const db = core.getDbInstance();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name?: string } | undefined;
  return Boolean(row?.name);
}

test.after(() => {
  delete process.env[EXTRA_DIRS_ENV];
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a failed migration names its restore point, releases the database, and the snapshot restores cleanly", async () => {
  // Provision the database and leave operator state in it.
  core
    .getDbInstance()
    .prepare(
      "INSERT INTO key_value (namespace, key, value) VALUES ('rollback-test', 'marker', 'before-upgrade')"
    )
    .run();
  core.resetDbInstance();
  assert.deepEqual(listSnapshots(), [], "a fresh install takes no snapshot");

  // Ship a broken "upgrade": the second statement fails inside the migration transaction.
  const rbDir = fs.mkdtempSync(path.join(os.tmpdir(), "omr-rollback-mig-"));
  fs.writeFileSync(
    path.join(rbDir, "001_boom.sql"),
    "CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY);\n" +
      "INSERT INTO table_that_does_not_exist (id) VALUES (1);\n"
  );
  process.env[EXTRA_DIRS_ENV] = `rb=${rbDir}`;

  let failure: Error | null = null;
  try {
    core.getDbInstance();
  } catch (error) {
    failure = error as Error;
  }
  assert.ok(failure, "the broken upgrade must abort startup");

  const snapshots = listSnapshots();
  assert.equal(snapshots.length, 1, "the runner takes exactly one pre-migration snapshot");
  const snapshotId = snapshots[0];
  const snapshotPath = path.join(BACKUP_DIR, snapshotId);
  assert.equal(
    hashFileSync(snapshotPath),
    snapshotId.match(SNAPSHOT_ID)![1],
    "the snapshot is content-addressed by its own sha256"
  );

  // (1) The failure must point the operator at that exact snapshot.
  assert.match(failure.message, /no such table: table_that_does_not_exist/);
  assert.match(failure.message, /Restore point/i);
  assert.ok(
    failure.message.includes(snapshotId),
    `failure must name the snapshot id ${snapshotId}; got: ${failure.message}`
  );

  // (2) Nothing of the failed upgrade may have landed, and the file must be free to replace.
  delete process.env[EXTRA_DIRS_ENV];
  const result = await backup.restoreDbBackup(snapshotId);
  assert.equal(result.restored, true);
  assert.equal(result.backupId, snapshotId);

  assert.equal(readMarker(), "before-upgrade", "operator state survives the rollback");
  assert.equal(hasTable("rollback_probe"), false, "the failed migration's DDL was not kept");
  const ledger = core
    .getDbInstance()
    .prepare("SELECT version FROM _omniroute_migrations WHERE version LIKE 'rb-%'")
    .all() as Array<{ version: string }>;
  assert.deepEqual(ledger, [], "the failed migration is not recorded as applied");
  core.resetDbInstance();
  fs.rmSync(rbDir, { recursive: true, force: true });
});

test("restoring a content-addressed snapshot whose bytes do not match its name is refused", async () => {
  // A structurally valid SQLite file published under a foreign content address: the
  // integrity check alone would accept it.
  const bogusPath = path.join(BACKUP_DIR, `db_state-${"0".repeat(64)}_pre-migration.sqlite`);
  const bogus = new Database(bogusPath);
  bogus.exec(
    "CREATE TABLE provider_connections (id TEXT PRIMARY KEY); CREATE TABLE lure (id INTEGER);"
  );
  bogus.close();
  assert.notEqual(hashFileSync(bogusPath), "0".repeat(64));

  const before = readMarker();
  core.resetDbInstance();

  await assert.rejects(
    backup.restoreDbBackup(path.basename(bogusPath)),
    /content address/i,
    "a snapshot whose sha256 differs from its name must not be restored"
  );

  assert.equal(readMarker(), before, "the live database is untouched after the refusal");
  assert.equal(hasTable("lure"), false);
  core.resetDbInstance();
});
