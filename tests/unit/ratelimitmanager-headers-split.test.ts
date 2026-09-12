/**
 * Characterization + API-surface test: rateLimitManager.ts god-file decomposition.
 *
 * The pure rate-limit HEADER parsing block (STANDARD_HEADERS, ANTHROPIC_HEADERS,
 * parseResetTime, toPlainHeaders) was extracted verbatim from
 * open-sse/services/rateLimitManager.ts into the ZERO-IMPORT, self-contained
 * leaf open-sse/services/rateLimitManager/headers.ts. The stateful limiter
 * machinery (Bottleneck, watchdog timers, learned-limits Map) stays in the host.
 *
 * Verifies that:
 *   1. parseResetTime / toPlainHeaders behave correctly (pure, DB/timer-free).
 *   2. The host rateLimitManager.ts still exposes the FULL public API (17 names).
 *   3. The headers leaf exports its pieces directly.
 *
 * The host import is released in a test.after hook (watchdog timers) so the
 * native runner does not hang — mirrors the DB-handle teardown discipline.
 *
 * The host is imported BEFORE the first test() registration on purpose. node:test
 * starts running the file's tests as soon as they are registered; a top-level
 * `await import()` placed between registrations races the runner: the host chain
 * (DB, schedulers, hundreds of modules) evaluates while tests 1–5 run, the root
 * run is already winding down when tests 6–7 are registered late, and the async
 * test 7 is cancelled with "Promise resolution is still pending but the event
 * loop has already resolved" (any `await import()` in that late test hangs).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  STANDARD_HEADERS,
  ANTHROPIC_HEADERS,
  parseResetTime,
  toPlainHeaders,
} from "../../open-sse/services/rateLimitManager/headers.ts";

const host = await import("../../open-sse/services/rateLimitManager.ts");

test.after(async () => {
  // release watchdog timers / limiter state so the runner exits cleanly
  try {
    await host.__resetRateLimitManagerForTests?.();
  } catch {
    /* ignore */
  }
  host.stopRateLimitWatchdog?.();
});

// ── 1. pure helpers ──────────────────────────────────────────────────────────

test("rateLimitManager/headers — parseResetTime: nullish → null", () => {
  assert.equal(parseResetTime(""), null);
  assert.equal(parseResetTime(null), null);
  assert.equal(parseResetTime("not-a-duration"), null);
});

test("rateLimitManager/headers — parseResetTime: duration strings → ms", () => {
  assert.equal(parseResetTime("30s"), 30_000);
  assert.equal(parseResetTime("500ms"), 500);
  assert.equal(parseResetTime("1m30s"), 90_000);
});

test("rateLimitManager/headers — parseResetTime: bare number → seconds*1000", () => {
  assert.equal(parseResetTime("5"), 5_000);
});

test("rateLimitManager/headers — toPlainHeaders normalizes to a string record", () => {
  const out = toPlainHeaders({ "X-RateLimit-Remaining": "10", "Content-Type": "application/json" });
  assert.equal(typeof out, "object");
  assert.ok(out !== null && !Array.isArray(out));
  // every value is a string
  for (const v of Object.values(out)) assert.equal(typeof v, "string");
});

test("rateLimitManager/headers — STANDARD/ANTHROPIC header maps are objects with string fields", () => {
  assert.equal(typeof STANDARD_HEADERS, "object");
  assert.equal(typeof ANTHROPIC_HEADERS, "object");
  assert.equal(typeof STANDARD_HEADERS.overLimit, "string");
});

// ── 2. host public API surface (17) ──────────────────────────────────────────

test("rateLimitManager.ts public API surface (17 names)", () => {
  const expected = [
    "__flushLearnedLimitsForTests",
    "__getLimiterStateForTests",
    "__resetRateLimitManagerForTests",
    "applyRequestQueueSettings",
    "disableRateLimitProtection",
    "enableRateLimitProtection",
    "getAllRateLimitStatus",
    "getLearnedLimits",
    "getRateLimitStatus",
    "initializeRateLimits",
    "isRateLimitEnabled",
    "refreshConnectionRateLimits",
    "startRateLimitWatchdog",
    "stopRateLimitWatchdog",
    "updateFromHeaders",
    "updateFromResponseBody",
    "withRateLimit",
  ];
  const missing = expected.filter((n) => typeof host[n] !== "function");
  assert.deepEqual(missing, [], `missing public exports: ${missing.join(", ")}`);
});

// ── 3. leaf exports its pieces ───────────────────────────────────────────────

test("headers.ts exports its helpers directly", async () => {
  const h = await import("../../open-sse/services/rateLimitManager/headers.ts");
  assert.equal(typeof h.parseResetTime, "function");
  assert.equal(typeof h.toPlainHeaders, "function");
  assert.equal(typeof h.STANDARD_HEADERS, "object");
  assert.equal(typeof h.ANTHROPIC_HEADERS, "object");
});
