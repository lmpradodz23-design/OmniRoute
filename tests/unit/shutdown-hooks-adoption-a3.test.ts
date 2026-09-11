// Final audit A-3: R-6 delivered the shutdown-hook registry and a test of the registry, but no
// production module registered a hook — every module-level setInterval still ran into a
// closing process. This guard pins the adoption: each scheduler below registers its stopper
// (statically, so a future refactor cannot silently drop it) and the one cheap enough to
// start in a unit test proves the hook really stops the timer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ADOPTERS: Array<[file: string, hook: string, stopper: string]> = [
  ["src/lib/arenaEloSync.ts", "arena-elo-sync", "stopArenaEloSync"],
  ["src/lib/contextWindowResolver.ts", "context-window-reconcile", "stopContextWindowReconcile"],
  ["src/lib/db/cleanup.ts", "db-cleanup-scheduler", "stopCleanupScheduler"],
  [
    "src/lib/jobs/reasoningCacheCleanupJob.ts",
    "reasoning-cache-cleanup",
    "stopReasoningCacheCleanupJob",
  ],
  ["src/lib/memory/typedDecay.ts", "memory-decay-sweep", "stopMemoryDecaySweep"],
  ["src/lib/modelsDevSync.ts", "models-dev-sync", "stopPeriodicSync"],
  ["src/lib/pricingSync.ts", "pricing-sync", "stopPeriodicSync"],
  [
    "src/lib/proxySubscription/subscriptionService.ts",
    "proxy-subscription-scheduler",
    "stopSubscriptionScheduler",
  ],
  ["src/lib/services/quotaAutoPing.ts", "quota-auto-ping", "stopQuotaAutoPing"],
  ["open-sse/services/rateLimitManager.ts", "rate-limit-watchdog", "stopRateLimitWatchdog"],
];

for (const [file, hook, stopper] of ADOPTERS) {
  test(`${file} registers its scheduler stopper as shutdown hook "${hook}"`, () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL(`../../${file}`, import.meta.url)),
      "utf8"
    );
    assert.match(source, /import \{ registerShutdownHook \} from "[^"]*shutdownHooks(?:\.ts)?";/);
    assert.ok(
      source.includes(`registerShutdownHook("${hook}", ${stopper});`),
      `${file} must register ${stopper} under "${hook}" where its timer starts`
    );
  });
}

test("the registered hook really stops a module scheduler (reasoning-cache cleanup)", async () => {
  const hooks = await import("../../src/lib/shutdownHooks.ts");
  const job = await import("../../src/lib/jobs/reasoningCacheCleanupJob.ts");
  hooks.unregisterShutdownHook("reasoning-cache-cleanup");
  process.env.OMNIROUTE_REASONING_CACHE_CLEANUP_INTERVAL_MS = "60000";
  try {
    const timer = job.startReasoningCacheCleanupJob();
    assert.ok(timer, "job started");
    const hook = hooks.getShutdownHooks().get("reasoning-cache-cleanup");
    assert.equal(typeof hook, "function", "starting the job registers its shutdown hook");
    await hook!();
    // A second start after the hook ran creates a NEW timer — proof the old one was cleared
    // (the start is a no-op while a timer is live).
    const again = job.startReasoningCacheCleanupJob();
    assert.notEqual(again, timer, "the hook cleared the timer, so start() scheduled a fresh one");
  } finally {
    job.stopReasoningCacheCleanupJob();
    hooks.unregisterShutdownHook("reasoning-cache-cleanup");
    delete process.env.OMNIROUTE_REASONING_CACHE_CLEANUP_INTERVAL_MS;
  }
});

test("gracefulShutdown re-exports the registry so existing callers keep working", async () => {
  const shutdown = await import("../../src/lib/gracefulShutdown.ts");
  const hooks = await import("../../src/lib/shutdownHooks.ts");
  const unregister = shutdown.registerShutdownHook("a3-reexport", () => {});
  assert.equal(hooks.getShutdownHooks().has("a3-reexport"), true, "same registry object");
  unregister();
  assert.equal(hooks.getShutdownHooks().has("a3-reexport"), false);
});
