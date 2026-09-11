// R-3 (audit/02-ARCHITECTURE.md): several processes legitimately open the same SQLite
// file (Electron inspection, VACUUM INTO snapshots, backups, a second instance). Once
// busy_timeout elapsed, a write that met the lock threw SQLITE_BUSY straight into the
// request; the only retry lived in the startup probe. The adapters now retry a busy
// write a bounded number of times outside an open transaction.
//
// The lock is held from a real second process (node:sqlite), so the synchronous retry
// sleeps on this thread cannot be what releases it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";

import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.ts";
import { createNodeSqliteAdapterFromDatabase } from "../../src/lib/db/adapters/nodeSqliteShared.ts";
import type { SqliteAdapter } from "../../src/lib/db/adapters/types.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r3-busy-"));
const file = path.join(dir, "storage.sqlite");

// Seed the schema with a throwaway connection so every adapter under test opens an
// existing WAL file, like production.
{
  const seed = new Database(file);
  seed.pragma("journal_mode = WAL");
  seed.exec("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, note TEXT)");
  seed.close();
}

const children: ChildProcess[] = [];

/**
 * Holds the write lock (BEGIN IMMEDIATE) from another process for `holdMs`. The holder
 * itself waits up to 5 s for the lock, so a previous test's connection finishing its WAL
 * checkpoint cannot make it exit before signalling. Returns the child so each test can
 * kill a long holder in `finally` instead of leaking it into the next test.
 */
async function holdWriteLock(holdMs: number): Promise<ChildProcess> {
  const ready = path.join(dir, `ready-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const script = [
    `import { DatabaseSync } from "node:sqlite";`,
    `import fs from "node:fs";`,
    `const db = new DatabaseSync(${JSON.stringify(file)}, { timeout: 5000 });`,
    `db.exec("BEGIN IMMEDIATE");`,
    `fs.writeFileSync(${JSON.stringify(ready)}, "locked");`,
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs});`,
    `db.exec("COMMIT");`,
    `db.close();`,
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(child);
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(ready)) {
    if (child.exitCode !== null) throw new Error(`lock holder exited early: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`lock holder never signalled readiness: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return child;
}

function waitForExit(child: ChildProcess): Promise<void> {
  return child.exitCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once("exit", () => resolve()));
}

test.after(() => {
  for (const child of children) child.kill();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const adapters: Array<{ name: string; open: () => SqliteAdapter }> = [
  {
    name: "better-sqlite3",
    open: () => {
      const db = new Database(file);
      db.pragma("busy_timeout = 20");
      return createBetterSqliteAdapter(db);
    },
  },
  {
    name: "node:sqlite",
    open: () => {
      const db = new DatabaseSync(file, { timeout: 20 });
      return createNodeSqliteAdapterFromDatabase(db as never, file);
    },
  },
];

for (const { name, open } of adapters) {
  test(`${name}: a write that meets a transient lock past busy_timeout is retried and lands`, async () => {
    const adapter = open();
    const holder = await holdWriteLock(150); // past busy_timeout, inside the retry budget
    try {
      const started = Date.now();
      const result = adapter
        .prepare("INSERT INTO probe (note) VALUES (?)")
        .run(`${name}-transient`);
      assert.equal(result.changes, 1);
      assert.ok(Date.now() - started >= 100, "the write really waited for the lock holder");
      const row = adapter
        .prepare("SELECT note FROM probe WHERE note = ?")
        .get(`${name}-transient`) as { note: string } | undefined;
      assert.equal(row?.note, `${name}-transient`);
    } finally {
      adapter.close();
      await waitForExit(holder);
    }
  });

  test(`${name}: a lock that never clears still fails fast (bounded retry budget)`, async () => {
    const adapter = open();
    const holder = await holdWriteLock(3_000);
    try {
      const started = Date.now();
      assert.throws(
        () => adapter.prepare("INSERT INTO probe (note) VALUES (?)").run(`${name}-stuck`),
        (error: unknown) => /database is locked|SQLITE_BUSY/i.test(String((error as Error).message))
      );
      assert.ok(Date.now() - started < 1_500, "retries must be bounded, not wait out the holder");
    } finally {
      adapter.close();
      holder.kill();
      await waitForExit(holder);
    }
  });

  test(`${name}: a transient lock on an IMMEDIATE transaction is retried as a whole`, async () => {
    const adapter = open();
    const holder = await holdWriteLock(150);
    try {
      adapter.immediate(() => {
        adapter.prepare("INSERT INTO probe (note) VALUES (?)").run(`${name}-immediate`);
      });
      const row = adapter
        .prepare("SELECT COUNT(*) AS n FROM probe WHERE note = ?")
        .get(`${name}-immediate`) as { n: number };
      assert.equal(row.n, 1);
    } finally {
      adapter.close();
      await waitForExit(holder);
    }
  });
}
