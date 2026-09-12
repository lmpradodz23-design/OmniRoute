/**
 * Pre-update snapshot of the user's data directory (E-5).
 *
 * electron-updater replaces the application in place. The database migration runner
 * already snapshots the DB before a schema change, but a new version that corrupts
 * configuration — or the DB without migrating — left no restore point. Right before
 * quitAndInstall the main process copies the database (with WAL/SHM), server.env, .env
 * and electron-preferences.json into
 *   <DATA_DIR>/db_backups/pre-update-<fromVersion>-<timestamp>/
 * together with a manifest, and keeps only the newest PRE_UPDATE_KEEP snapshots.
 *
 * Pure (fs injectable), never throws: the caller decides what a failed snapshot means.
 * Restore = stop OmniRoute, copy the files back (see audit/ROLLBACK.md §2.3).
 */

const nodeFs = require("fs");
const path = require("path");

const SNAPSHOT_FILES = [
  "storage.sqlite",
  "storage.sqlite-wal",
  "storage.sqlite-shm",
  "server.env",
  ".env",
  "electron-preferences.json",
];
const PRE_UPDATE_PREFIX = "pre-update-";
const PRE_UPDATE_KEEP = 3;

function safeVersion(version) {
  return String(version || "unknown").replace(/[^0-9A-Za-z.\-]/g, "_");
}

function timestampLabel(ms) {
  return new Date(ms).toISOString().replace(/[:.]/g, "-").replace("T", "T").slice(0, 19);
}

/**
 * @param {{ dataDir: string, fromVersion?: string, toVersion?: string,
 *           fsImpl?: typeof nodeFs, now?: () => number, keep?: number }} input
 * @returns {{ dir: string|null, copied: string[], skipped: string[], pruned: string[], error?: string }}
 */
function createPreUpdateSnapshot({
  dataDir,
  fromVersion,
  toVersion,
  fsImpl = nodeFs,
  now = Date.now,
  keep = PRE_UPDATE_KEEP,
}) {
  const result = { dir: null, copied: [], skipped: [], pruned: [] };
  try {
    const backupsDir = path.join(dataDir, "db_backups");
    const createdAt = now();
    const dir = path.join(
      backupsDir,
      `${PRE_UPDATE_PREFIX}${safeVersion(fromVersion)}-${timestampLabel(createdAt)}`
    );
    fsImpl.mkdirSync(dir, { recursive: true });
    result.dir = dir;

    for (const name of SNAPSHOT_FILES) {
      const source = path.join(dataDir, name);
      if (!fsImpl.existsSync(source)) {
        result.skipped.push(name);
        continue;
      }
      fsImpl.copyFileSync(source, path.join(dir, name));
      result.copied.push(name);
    }

    fsImpl.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        {
          kind: "pre-update",
          fromVersion: fromVersion ?? null,
          toVersion: toVersion ?? null,
          createdAt: new Date(createdAt).toISOString(),
          files: result.copied,
        },
        null,
        2
      )
    );

    // Retention: newest `keep` snapshots survive (names sort chronologically).
    const older = fsImpl
      .readdirSync(backupsDir)
      .filter((entry) => entry.startsWith(PRE_UPDATE_PREFIX))
      .sort();
    while (older.length > keep) {
      const victim = older.shift();
      fsImpl.rmSync(path.join(backupsDir, victim), { recursive: true, force: true });
      result.pruned.push(victim);
    }
    return result;
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = { PRE_UPDATE_KEEP, PRE_UPDATE_PREFIX, SNAPSHOT_FILES, createPreUpdateSnapshot };
