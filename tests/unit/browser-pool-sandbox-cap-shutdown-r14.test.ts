// R-14 / E-8 (audit/02-ARCHITECTURE.md): the browser pool launched Chromium with
// --no-sandbox unconditionally (rendering third-party pages without the renderer
// sandbox on every host), kept an unbounded number of contexts (only a 10-minute TTL),
// and had no process-exit hook, so a SIGTERM left Chromium and its contexts behind.
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  chromiumSandboxArgs,
  resolvePlainBrowserLaunchOptions,
  selectContextsToEvict,
  getBrowserPoolMetrics,
  __resetBrowserPoolMetricsForTest,
} from "../../open-sse/services/browserPool.ts";

describe("chromiumSandboxArgs (R-14)", () => {
  it("keeps the Chromium sandbox for a regular user", () => {
    assert.deepEqual(chromiumSandboxArgs({ env: {}, uid: 1000 }), []);
    assert.equal(
      resolvePlainBrowserLaunchOptions({}, { env: {}, uid: 1000 }).args?.includes("--no-sandbox"),
      false
    );
  });

  it("drops the sandbox only when running as root (Chromium refuses to start otherwise)", () => {
    assert.deepEqual(chromiumSandboxArgs({ env: {}, uid: 0 }), ["--no-sandbox"]);
  });

  it("honours an explicit operator override", () => {
    assert.deepEqual(
      chromiumSandboxArgs({ env: { OMNIROUTE_BROWSER_NO_SANDBOX: "1" }, uid: 1000 }),
      ["--no-sandbox"]
    );
    assert.deepEqual(chromiumSandboxArgs({ env: { OMNIROUTE_BROWSER_NO_SANDBOX: "0" }, uid: 0 }), [
      "--no-sandbox",
    ]);
  });

  it("treats an unknown uid (Windows has none) as a regular user", () => {
    assert.deepEqual(chromiumSandboxArgs({ env: {}, uid: undefined }), []);
  });
});

describe("selectContextsToEvict (R-14 context cap)", () => {
  const entry = (id: string, lastUsed: number) => [id, { lastUsed }] as const;

  it("returns nothing while under the cap", () => {
    assert.deepEqual(selectContextsToEvict([entry("a", 1), entry("b", 2)], 8), []);
  });

  it("evicts the least recently used contexts to make room for one more", () => {
    const contexts = [entry("a", 30), entry("b", 10), entry("c", 20), entry("d", 40)];
    assert.deepEqual(selectContextsToEvict(contexts, 4), ["b"]);
    assert.deepEqual(selectContextsToEvict(contexts, 3), ["b", "c"]);
  });

  it("a cap below 1 is clamped to 1: everything goes so the incoming context is the only one", () => {
    assert.deepEqual(selectContextsToEvict([entry("a", 1), entry("b", 2)], 0), ["a", "b"]);
    assert.deepEqual(selectContextsToEvict([], 0), []);
  });
});

test("graceful shutdown closes the browser pool", async () => {
  const previousState = globalThis.__omnirouteShutdown;
  const previousHooks = globalThis.__omnirouteShutdownHooks;
  delete globalThis.__omnirouteShutdown;
  delete globalThis.__omnirouteShutdownHooks;
  try {
    __resetBrowserPoolMetricsForTest();
    const url = pathToFileURL(path.join(process.cwd(), "src/lib/gracefulShutdown.ts")).href;
    const shutdown = (await import(
      `${url}?r14`
    )) as typeof import("../../src/lib/gracefulShutdown.ts");
    await shutdown.requestGracefulShutdown("SIGTERM");
    const { metrics } = getBrowserPoolMetrics();
    assert.equal(metrics.shutdowns, 1, "the pool is shut down exactly once on process shutdown");
    assert.equal(metrics.lastShutdownReason, "process-shutdown");
  } finally {
    if (previousState === undefined) delete globalThis.__omnirouteShutdown;
    else globalThis.__omnirouteShutdown = previousState;
    if (previousHooks === undefined) delete globalThis.__omnirouteShutdownHooks;
    else globalThis.__omnirouteShutdownHooks = previousHooks;
  }
});
