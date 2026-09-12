// R-2 (audit/02-ARCHITECTURE.md): a call log is an artifact file plus a call_logs row that
// is the file's ONLY reference (detail, export and purge all navigate row → artifact).
// The artifact is written first, so a failing INSERT used to leave an unreachable file in
// DATA_DIR/call_logs forever. The fault is injected with a SQLite trigger on the INSERT.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { useDecollidedMigrationsDir } from "./helpers/decollidedMigrationsDir.ts";

useDecollidedMigrationsDir();
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r2-orphan-artifact-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const callLogs = await import("../../src/lib/usage/callLogs.ts");
const artifactWriter = await import("../../src/lib/usage/callLogArtifactWriter.ts");

const CALL_LOGS_DIR = path.join(TEST_DATA_DIR, "call_logs");

function listArtifactFiles(dir = CALL_LOGS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? listArtifactFiles(path.join(dir, entry.name))
        : [path.join(dir, entry.name)]
    );
}

function entry(id: string) {
  return {
    id,
    timestamp: "2026-09-10T12:34:56.789Z",
    status: 200,
    model: "test-model",
    provider: "test-provider",
    requestBody: { probe: id },
    responseBody: { ok: true },
  };
}

test.after(async () => {
  await artifactWriter.closeCallLogArtifactWriter();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a call log whose row cannot be inserted leaves no orphan artifact behind", async () => {
  const db = core.getDbInstance();
  db.exec(
    "CREATE TRIGGER r2_call_log_fault BEFORE INSERT ON call_logs BEGIN SELECT RAISE(ABORT, 'r2-fault'); END;"
  );
  try {
    void callLogs.saveCallLog(entry("orphan-1"));
    assert.equal(await callLogs.waitForCallLogSaves(10_000), true);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS r2_call_log_fault");
  }

  const row = db.prepare("SELECT id FROM call_logs WHERE id = ?").get("orphan-1");
  assert.equal(row, undefined, "the faulted insert must not have landed");
  assert.deepEqual(
    listArtifactFiles(),
    [],
    "the artifact written for the failed row must be removed, not leaked"
  );

  // Without the fault the row references its artifact as usual.
  void callLogs.saveCallLog(entry("kept-1"));
  assert.equal(await callLogs.waitForCallLogSaves(10_000), true);
  const kept = db
    .prepare("SELECT detail_state, artifact_relpath FROM call_logs WHERE id = ?")
    .get("kept-1") as { detail_state: string; artifact_relpath: string | null };
  assert.equal(kept.detail_state, "ready");
  assert.ok(kept.artifact_relpath);
  assert.equal(listArtifactFiles().length, 1);
  assert.equal(
    fs.existsSync(path.join(CALL_LOGS_DIR, kept.artifact_relpath as string)),
    true,
    "the successful row's artifact stays"
  );
});
