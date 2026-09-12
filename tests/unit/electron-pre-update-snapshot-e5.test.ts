// E-5 (audit/03-SECURITY-FINDINGS.md): the desktop updater replaced the application
// without any snapshot of the user's data. The pre-migration snapshot only covers a
// migrating database; a new version that corrupts configuration or the DB without a
// migration left no restore point. Before quitAndInstall the main process now copies the
// database, WAL/SHM, server.env, .env and electron-preferences.json into
// <DATA_DIR>/db_backups/pre-update-<version>-<ts>/ and keeps the last few snapshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const {
  createPreUpdateSnapshot,
  PRE_UPDATE_KEEP,
} = require("../../electron/lib/preUpdateSnapshot");

let dataDir: string;

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pre-update-"));
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function seed(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dataDir, name), content);
  }
}

describe("Electron pre-update snapshot (E-5)", () => {
  it("main.js snapshots before quitAndInstall on both install paths", () => {
    const mainSrc = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../electron/main.js"),
      "utf8"
    );
    const installFn = mainSrc.slice(
      mainSrc.indexOf("function installUpdate()"),
      mainSrc.indexOf("autoUpdater.quitAndInstall();", mainSrc.indexOf("function installUpdate()"))
    );
    assert.match(installFn, /createPreUpdateSnapshot\(/, "snapshot runs inside installUpdate()");
    // The notification click must go through installUpdate() too (server kill + snapshot).
    assert.doesNotMatch(
      mainSrc.replace(installFn, ""),
      /notification\.on\("click", \(\) => \{\s*autoUpdater\.quitAndInstall/,
      "the notification click must not bypass installUpdate()"
    );
    assert.match(mainSrc, /notification\.on\("click", \(\) => \{\s*installUpdate\(\);/);
  });

  it("copies the database, its WAL/SHM and the config files into a timestamped folder", () => {
    seed({
      "storage.sqlite": "db-bytes",
      "storage.sqlite-wal": "wal",
      "storage.sqlite-shm": "shm",
      "server.env": "OMNIROUTE_SECRET=x",
      ".env": "PORT=20128",
      "electron-preferences.json": "{}",
      "log.txt": "not copied",
    });
    const result = createPreUpdateSnapshot({
      dataDir,
      fromVersion: "3.8.50",
      toVersion: "3.8.51",
      now: () => new Date("2026-09-11T12:00:00Z").getTime(),
    });
    assert.equal(result.error, undefined);
    assert.ok(result.dir.startsWith(path.join(dataDir, "db_backups", "pre-update-3.8.50-")));
    assert.deepEqual([...result.copied].sort(), [
      ".env",
      "electron-preferences.json",
      "server.env",
      "storage.sqlite",
      "storage.sqlite-shm",
      "storage.sqlite-wal",
    ]);
    assert.equal(fs.readFileSync(path.join(result.dir, "storage.sqlite"), "utf8"), "db-bytes");
    assert.equal(fs.existsSync(path.join(result.dir, "log.txt")), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(result.dir, "manifest.json"), "utf8"));
    assert.equal(manifest.fromVersion, "3.8.50");
    assert.equal(manifest.toVersion, "3.8.51");
    assert.equal(manifest.createdAt, "2026-09-11T12:00:00.000Z");
  });

  it("skips files that do not exist instead of failing", () => {
    for (const f of fs.readdirSync(dataDir)) {
      if (f !== "db_backups") fs.rmSync(path.join(dataDir, f), { recursive: true, force: true });
    }
    seed({ "storage.sqlite": "only-db" });
    const result = createPreUpdateSnapshot({ dataDir, fromVersion: "3.8.50", toVersion: "3.8.51" });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.copied, ["storage.sqlite"]);
    assert.ok(result.skipped.includes("server.env"));
  });

  it("prunes old pre-update snapshots beyond the retention count, newest kept", () => {
    const base = new Date("2030-01-01T00:00:00Z").getTime();
    for (let i = 0; i < PRE_UPDATE_KEEP + 2; i += 1) {
      createPreUpdateSnapshot({
        dataDir,
        fromVersion: "3.8.50",
        toVersion: "3.8.51",
        now: () => base + i * 60_000,
      });
    }
    const dirs = fs
      .readdirSync(path.join(dataDir, "db_backups"))
      .filter((d) => d.startsWith("pre-update-"))
      .sort();
    assert.equal(dirs.length, PRE_UPDATE_KEEP);
    assert.ok(
      dirs[dirs.length - 1].includes("2030-01-01T00-0"),
      "newest snapshot survives pruning"
    );
  });

  it("reports an error instead of throwing when the data dir is unwritable", () => {
    const result = createPreUpdateSnapshot({
      dataDir: path.join(dataDir, "missing", "nested"),
      fromVersion: "3.8.50",
      toVersion: "3.8.51",
      fsImpl: {
        ...fs,
        mkdirSync: () => {
          throw new Error("EACCES: permission denied");
        },
      },
    });
    assert.match(result.error ?? "", /EACCES/);
    assert.deepEqual(result.copied, []);
  });
});
