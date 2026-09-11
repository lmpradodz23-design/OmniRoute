// R-6 (audit/02-ARCHITECTURE.md): the shutdown sequence drained requests and closed the
// database, but never stopped the background schedulers (job registry, backup schedule,
// proxy-health / free-proxy sync, credential auto-refresh) — timers kept firing into a
// closing process and could touch the database after it was closed. Shutdown now stops
// background work FIRST (so nothing new starts while draining), runs the hooks modules
// register for their own timers, then drains and cleans up.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-r6-shutdown-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

type GracefulShutdownModule = typeof import("../../src/lib/gracefulShutdown.ts");
const gracefulShutdownUrl = pathToFileURL(
  path.join(process.cwd(), "src/lib/gracefulShutdown.ts")
).href;

const core = await import("../../src/lib/db/core.ts");
const { getJobRegistry, __resetJobRegistry } = await import("../../src/lib/jobRegistry/index.ts");
const { autoRefreshDaemon } = await import("../../open-sse/services/autoRefreshDaemon.ts");

test.after(() => {
  __resetJobRegistry();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("graceful shutdown stops schedulers and runs registered hooks before closing the database", async () => {
  const previousState = globalThis.__omnirouteShutdown;
  const previousHooks = globalThis.__omnirouteShutdownHooks;
  delete globalThis.__omnirouteShutdown;
  delete globalThis.__omnirouteShutdownHooks;

  try {
    const shutdown = (await import(`${gracefulShutdownUrl}?r6=a`)) as GracefulShutdownModule;

    // Background work as the server boots it: a registry job on an interval and the
    // credential auto-refresh daemon.
    __resetJobRegistry();
    const registry = getJobRegistry();
    let ticks = 0;
    registry.register({
      id: "r6-interval-job",
      type: "interval",
      intervalMs: 20,
      enabled: true,
      handler: async () => {
        ticks += 1;
        return { success: true };
      },
    });
    registry.start("r6-interval-job");
    const timers = (registry as unknown as { timers: Map<string, unknown> }).timers;
    assert.equal(timers.size, 1, "the interval job is scheduled");
    autoRefreshDaemon.start();
    assert.equal((autoRefreshDaemon as unknown as { running: boolean }).running, true);

    // A module-owned timer registers its own hook (the pattern for the ~55 ad-hoc
    // setInterval sites): shutdown must call it while the database is still open.
    let hookRan = false;
    let dbOpenDuringHook: boolean | null = null;
    const moduleTimer = setInterval(() => {}, 1000);
    shutdown.registerShutdownHook("r6-module-timer", () => {
      hookRan = true;
      dbOpenDuringHook = core.getDbInstance().open;
      clearInterval(moduleTimer);
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    await shutdown.requestGracefulShutdown("SIGTERM");

    assert.equal(hookRan, true, "registered shutdown hooks run");
    assert.equal(dbOpenDuringHook, true, "hooks run before the database is closed");
    assert.equal(timers.size, 0, "job registry timers are stopped");
    assert.equal(
      (autoRefreshDaemon as unknown as { running: boolean }).running,
      false,
      "auto-refresh daemon is stopped"
    );
    const ticksAtShutdown = ticks;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(ticks, ticksAtShutdown, "no job fires after shutdown completed");
  } finally {
    if (previousState === undefined) delete globalThis.__omnirouteShutdown;
    else globalThis.__omnirouteShutdown = previousState;
    if (previousHooks === undefined) delete globalThis.__omnirouteShutdownHooks;
    else globalThis.__omnirouteShutdownHooks = previousHooks;
  }
});

test("registerShutdownHook is idempotent per name and returns an unregister handle", async () => {
  const previousHooks = globalThis.__omnirouteShutdownHooks;
  delete globalThis.__omnirouteShutdownHooks;
  try {
    const shutdown = (await import(`${gracefulShutdownUrl}?r6=b`)) as GracefulShutdownModule;
    const unregisterFirst = shutdown.registerShutdownHook("r6-dup", () => {});
    shutdown.registerShutdownHook("r6-dup", () => {});
    assert.equal(
      globalThis.__omnirouteShutdownHooks?.size,
      1,
      "same name replaces, never duplicates"
    );
    unregisterFirst();
    assert.equal(
      globalThis.__omnirouteShutdownHooks?.size,
      1,
      "a stale handle does not remove the hook that replaced it"
    );
    shutdown.unregisterShutdownHook("r6-dup");
    assert.equal(globalThis.__omnirouteShutdownHooks?.size, 0);
  } finally {
    if (previousHooks === undefined) delete globalThis.__omnirouteShutdownHooks;
    else globalThis.__omnirouteShutdownHooks = previousHooks;
  }
});
