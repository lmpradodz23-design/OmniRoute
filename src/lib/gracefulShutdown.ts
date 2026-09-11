/**
 * Graceful Shutdown — E-2 Critical Fix
 *
 * Handles SIGTERM / SIGINT to drain in-flight requests before exit.
 * Critical for Docker containers and Kubernetes pods where hard kills
 * can drop active SSE streams.
 *
 * Usage:
 *   import { initGracefulShutdown } from "@/lib/gracefulShutdown";
 *   initGracefulShutdown();
 *
 * @module lib/gracefulShutdown
 */

import { markServerStopping } from "@/lib/serverLifecycle";

/** Grace period before forced exit (default 30s, configurable) */
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "30000", 10);

declare global {
  var __omnirouteShutdown:
    | {
        init: boolean;
        shuttingDown: boolean;
        activeRequests: number;
        shutdownPromise?: Promise<void>;
      }
    | undefined;
  var __omnirouteRequestShutdown: ((signal: string) => Promise<void>) | undefined;
  var __omnirouteCustomServerOwnsShutdown: boolean | undefined;
  var __omnirouteShutdownHooks: Map<string, ShutdownHook> | undefined;
}

export type ShutdownHook = () => void | Promise<void>;

/** Per-step budget while stopping background work; a stuck stopper must not block exit. */
const STOP_STEP_TIMEOUT_MS = 5_000;

function getShutdownHooks(): Map<string, ShutdownHook> {
  // On globalThis so HMR module instances and the custom server share one registry.
  return (globalThis.__omnirouteShutdownHooks ??= new Map());
}

/**
 * Register teardown for a module-owned timer/worker (R-6). Runs at the START of graceful
 * shutdown — before requests drain and before the database closes — so no background job
 * fires into a closing process. Idempotent per `name`; returns an unregister handle that
 * only removes the hook it registered.
 */
export function registerShutdownHook(name: string, hook: ShutdownHook): () => void {
  getShutdownHooks().set(name, hook);
  return () => {
    if (getShutdownHooks().get(name) === hook) getShutdownHooks().delete(name);
  };
}

export function unregisterShutdownHook(name: string): void {
  getShutdownHooks().delete(name);
}

async function stopQuietly(name: string, stop: () => void | Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(stop),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[Shutdown] ${name} did not stop within ${STOP_STEP_TIMEOUT_MS}ms.`);
          resolve();
        }, STOP_STEP_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn(`[Shutdown] ${name} failed to stop:`, (err as Error).message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Stop every background scheduler before draining (R-6): the job registry (budget reset,
 * log export, token health, cache cleanup), the backup schedule, proxy health / free-proxy
 * sync, the credential auto-refresh daemon, then the hooks modules registered for their
 * own timers. Each step is guarded and time-boxed; nothing here may keep the process up.
 */
async function stopBackgroundWork(): Promise<void> {
  const registry = (globalThis as { __omnirouteJobRegistry?: { dispose(): void } })
    .__omnirouteJobRegistry;
  if (registry) await stopQuietly("job registry", () => registry.dispose());

  const builtIns: Array<[string, () => Promise<void>]> = [
    [
      "backup schedule job",
      () => import("@/lib/jobs/backupScheduleJob").then((m) => m.stopBackupScheduleJob()),
    ],
    [
      "proxy health check",
      () => import("@/lib/proxyHealth/scheduler").then((m) => m.stopProxyHealthCheck()),
    ],
    [
      "free-proxy auto-sync",
      () => import("@/lib/freeProxyProviders/scheduler").then((m) => m.stopFreeProxyAutoSync()),
    ],
    [
      "auto-refresh daemon",
      () =>
        import("@omniroute/open-sse/services/autoRefreshDaemon").then((m) =>
          m.autoRefreshDaemon.stop()
        ),
    ],
    // R-14: close pooled Chromium contexts/browsers so a SIGTERM never leaves them behind.
    [
      "browser pool",
      () =>
        import("@omniroute/open-sse/services/browserPool.ts").then((m) =>
          m.shutdownPool("process-shutdown")
        ),
    ],
  ];
  for (const [name, stop] of builtIns) await stopQuietly(name, stop);

  for (const [name, hook] of [...getShutdownHooks()]) await stopQuietly(`hook ${name}`, hook);
  console.log("[Shutdown] Background schedulers stopped.");
}

function getShutdownState() {
  if (!globalThis.__omnirouteShutdown) {
    globalThis.__omnirouteShutdown = { init: false, shuttingDown: false, activeRequests: 0 };
  }
  return globalThis.__omnirouteShutdown;
}

/**
 * Check if the server is currently shutting down.
 * Route handlers can use this to reject new requests.
 */
export function isDraining(): boolean {
  return getShutdownState().shuttingDown;
}

/**
 * Track a new in-flight request. Call `done()` when it completes.
 * Returns a done callback.
 */
export function trackRequest(): () => void {
  const state = getShutdownState();
  state.activeRequests++;
  let called = false;
  return () => {
    if (!called) {
      called = true;
      state.activeRequests--;
    }
  };
}

/**
 * Get current active request count (for monitoring/health endpoints).
 */
export function getActiveRequestCount(): number {
  return getShutdownState().activeRequests;
}

/**
 * Wait for all in-flight requests to complete, with timeout.
 */
async function waitForDrain(): Promise<void> {
  const state = getShutdownState();
  const start = Date.now();
  const CHECK_INTERVAL_MS = 250;

  return new Promise((resolve) => {
    const check = () => {
      if (state.activeRequests <= 0) {
        console.log("[Shutdown] All in-flight requests drained.");
        resolve();
        return;
      }

      if (Date.now() - start > SHUTDOWN_TIMEOUT_MS) {
        console.warn(
          `[Shutdown] Timeout after ${SHUTDOWN_TIMEOUT_MS}ms with ${state.activeRequests} active requests. Forcing exit.`
        );
        resolve();
        return;
      }

      console.log(`[Shutdown] Waiting for ${state.activeRequests} in-flight request(s)...`);
      setTimeout(check, CHECK_INTERVAL_MS);
    };

    check();
  });
}

/**
 * Perform cleanup: close DB connections, flush logs.
 */
async function cleanup(): Promise<void> {
  try {
    const [
      { closeAuditDb },
      { closeDbInstance },
      { flushSpendBatchWriter },
      { closeLogRotation },
      { closeSharedLoggerResource },
      { closeCallLogSaves },
    ] = await Promise.all([
      import("@omniroute/open-sse/mcp-server/audit.ts"),
      import("@/lib/db/core"),
      import("@/lib/spend/batchWriter"),
      import("@/lib/logRotation"),
      import("@/shared/utils/loggerResource"),
      import("@/lib/usage/callLogs"),
    ]);
    const flushResult = await flushSpendBatchWriter();
    if (flushResult.flushedEntries > 0) {
      console.log(
        `[Shutdown] Spend batch writer flushed ${flushResult.flushedEntries} pending entry(ies).`
      );
    }
    await closeCallLogSaves();
    if (closeAuditDb()) {
      console.log("[Shutdown] MCP audit database checkpointed and closed.");
    }
    if (closeDbInstance()) {
      console.log("[Shutdown] SQLite database checkpointed and closed.");
    }
    // Tear down any persistent VNC login browser containers so they don't leak
    // past the server process. Best-effort; no-op if the feature was never used
    // or the docker CLI is unavailable.
    try {
      const { stopAllSessions, listSessions } = await import("@/lib/vncSession/service");
      if (listSessions().length > 0) {
        await stopAllSessions();
        console.log("[Shutdown] VNC login sessions stopped.");
      }
    } catch {
      /* feature unused / docker missing */
    }

    try {
      const { stopChatGptWebCodexRuntime } =
        await import("@omniroute/open-sse/executors/chatgpt-web-codex/runtime.ts");
      await stopChatGptWebCodexRuntime();
      console.log("[Shutdown] ChatGPT Web (Codex) runtime stopped.");
    } catch {
      /* feature unused */
    }

    await closeSharedLoggerResource();
    closeLogRotation();
    console.log("[Shutdown] Logger transport and log rotation stopped.");
  } catch (err) {
    console.error("[Shutdown] Error during cleanup:", (err as Error).message);
  }
}

/**
 * Start the process-wide shutdown sequence, or join the sequence already in progress.
 */
export function requestGracefulShutdown(signal: string): Promise<void> {
  const state = getShutdownState();
  if (state.shutdownPromise) return state.shutdownPromise;

  state.shuttingDown = true;
  markServerStopping();
  state.shutdownPromise = (async () => {
    console.log(`\n[Shutdown] Received ${signal}. Draining ${state.activeRequests} request(s)...`);

    // R-6: stop background work first so no scheduler fires into the drain window or
    // touches the database after cleanup() closes it.
    await stopBackgroundWork();
    await waitForDrain();
    await cleanup();

    console.log("[Shutdown] Bye.");
  })();

  return state.shutdownPromise;
}

/**
 * Initialize graceful shutdown handlers.
 * Should be called once during server startup.
 */
export function initGracefulShutdown(): void {
  const state = getShutdownState();
  globalThis.__omnirouteRequestShutdown ??= requestGracefulShutdown;
  if (state.init) return;
  state.init = true;

  if (globalThis.__omnirouteCustomServerOwnsShutdown) {
    console.log("[Shutdown] Cleanup registered with the custom server shutdown owner.");
    return;
  }

  const shutdown = (signal: string) => {
    void globalThis.__omnirouteRequestShutdown?.(signal).then(() => process.exit(0));
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // #8045: on Windows, closing the console window delivers CTRL_CLOSE_EVENT, which
  // Node/libuv maps to a JS-visible "SIGHUP" event — without this listener, closing
  // the window never runs cleanup() (WAL checkpoint + closeDbInstance()), leaving
  // storage.sqlite's WAL un-checkpointed for the next launch.
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  console.log("[Shutdown] Graceful shutdown handlers registered.");
}
