import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditBundle } from "../../scripts/check/check-standalone-hygiene.mjs";
import { pruneStandaloneDir } from "../../scripts/build/build-next-isolated.mjs";

// X-1 release gate (Auditor B: the commit promised a gate that did not exist and the prune was
// non-fatal). The gate proves the bundle ON DISK: denylisted entries, env files, SQLite
// databases, private keys, server.pid, .npmrc anywhere outside node_modules, foreign dist dirs,
// and an own dist dir without server/.

async function plant(root, files) {
  for (const rel of files) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), "x");
  }
}

const CLEAN = [
  "server.js",
  path.join(".build", "next", "server", "app", "page.js"),
  path.join(".build", "next", "BUILD_ID"),
  ".env.example",
  path.join("node_modules", "some-dep", ".env"), // dependencies' own fixtures are out of scope
  path.join("docs", "guide.md"),
];

test("a clean bundle passes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-hygiene-clean-"));
  try {
    await plant(dir, CLEAN);
    assert.deepEqual(auditBundle(dir, { relDistDir: ".build/next" }), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("every class of offender is reported", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-hygiene-dirty-"));
  try {
    await plant(dir, [
      ...CLEAN,
      ".env",
      path.join("config", ".env.local"),
      "server.env",
      path.join(".git", "HEAD"),
      path.join("tests", "x.test.ts"),
      path.join(".install-upgrade", "ws", "b-data", "storage.sqlite"),
      path.join("deep", "dir", "cache.db-wal"),
      path.join("certs", "server.pem"),
      "server.pid",
      ".npmrc",
      path.join(".build", "next-verify", "server", "x.js"),
      path.join(".next", "server", "x.js"),
    ]);
    const offenders = auditBundle(dir, { relDistDir: ".build/next" });
    const text = offenders.join("\n");
    for (const expected of [
      "denylisted entry present: .env",
      "denylisted entry present: .git",
      "denylisted entry present: tests",
      "denylisted entry present: .install-upgrade",
      "env file: config/.env.local",
      "server.env: server.env",
      "sqlite database: .install-upgrade/ws/b-data/storage.sqlite",
      "sqlite database: deep/dir/cache.db-wal",
      "private key / cert bundle: certs/server.pem",
      "server.pid: server.pid",
      "npmrc (may carry an auth token): .npmrc",
      "foreign dist dir present: .build/next-verify",
      "foreign dist dir present: .next",
    ]) {
      assert.ok(text.includes(expected), `expected offender "${expected}" in:\n${text}`);
    }
    assert.ok(!text.includes(".env.example"), ".env.example is allowed");
    assert.ok(!text.includes("node_modules"), "node_modules is not walked");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("an own dist dir without server/ is an unbootable bundle and fails the gate (build #5 regression)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-hygiene-noserver-"));
  try {
    await plant(dir, ["server.js", path.join(".build", "next", "static", "x.css")]);
    const offenders = auditBundle(dir, { relDistDir: ".build/next" });
    assert.ok(
      offenders.some((o) => o.startsWith("own dist dir has no server/")),
      offenders.join("\n")
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("prune then gate: what the build script removes is exactly what the gate would flag at top level", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-hygiene-roundtrip-"));
  try {
    await plant(dir, [
      ...CLEAN,
      ".env",
      ".npmrc",
      "server.pid",
      path.join("data", "storage.sqlite"),
      path.join("logs", "app.log"),
      path.join("db_backups", "x.sqlite"),
      path.join(".git", "HEAD"),
      path.join(".build", "next-verify", "server", "x.js"),
    ]);
    assert.ok(auditBundle(dir, { relDistDir: ".build/next" }).length > 0, "dirty before the prune");
    await pruneStandaloneDir(dir, fs, { log() {} }, { relDistDir: ".build/next" });
    assert.deepEqual(auditBundle(dir, { relDistDir: ".build/next" }), [], "clean after the prune");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a prune failure is fatal, not a warning", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-hygiene-fatal-"));
  try {
    await plant(dir, [".env", path.join("tests", "x.test.ts")]);
    const failingFs = {
      ...fs,
      rm: async (target, opts) => {
        if (String(target).endsWith(".env")) {
          const err = new Error("EBUSY: resource busy or locked");
          err.code = "EBUSY";
          throw err;
        }
        return fs.rm(target, opts);
      },
    };
    await assert.rejects(
      () => pruneStandaloneDir(dir, failingFs, { log() {} }, { relDistDir: ".build/next" }),
      /standalone prune could not remove: \.env/
    );
    // the other targets were still attempted
    assert.equal(
      await fs.access(path.join(dir, "tests")).then(
        () => true,
        () => false
      ),
      false
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
