import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const { deliverWebhook } = await import("../../src/lib/webhookDispatcher.ts");

/** A loopback port that is guaranteed closed: bind an ephemeral port, read it, close it. */
async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// Regression for the dangling abort-timer leak: deliverWebhook arms a 10s
// setTimeout(() => controller.abort()) before each attempt. The pre-fix code only
// called clearTimeout on the success path, so a non-timeout network rejection
// (ECONNREFUSED, DNS failure, etc.) skipped clearTimeout, leaking a live 10s timer
// + AbortController per failed delivery. The fix clears the timer in a `finally`.
//
// SSRF finding S-1 moved delivery onto `hardenedWebhookFetch`, which resolves DNS
// and connects through a pinned undici agent, so mocking `globalThis.fetch` is no
// longer the seam (it would be bypassed and the test would hit real DNS). The
// failure is now a REAL refused connection on a closed loopback port — exactly the
// "non-timeout network rejection" this guard is about — under `allowPrivate: true`
// so the loopback target is admitted. The assertions are unchanged.
test("deliverWebhook clears the abort timer even when the connection is refused", async () => {
  // Acquire the port before installing the spies so its own listen/close timers are not counted.
  const port = await closedLoopbackPort();

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  type TimerHandle = ReturnType<typeof setTimeout>;
  type SetTimeoutArgs = Parameters<typeof setTimeout>;
  type ClearTimeoutArg = Parameters<typeof clearTimeout>[0];

  const abortTimerIds = new Set<TimerHandle>();
  const clearedIds = new Set<TimerHandle>();

  // Track the 10s abort timer ids; delegate to the real timer so ids stay valid.
  globalThis.setTimeout = ((...spyArgs: SetTimeoutArgs) => {
    const id = realSetTimeout(...spyArgs);
    if (spyArgs[1] === 10_000) abortTimerIds.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ClearTimeoutArg) => {
    if (id !== undefined && id !== null) clearedIds.add(id as TimerHandle);
    return realClearTimeout(id);
  }) as typeof clearTimeout;

  try {
    const res = await deliverWebhook(
      `http://127.0.0.1:${port}/webhook`,
      { event: "test.ping", timestamp: new Date().toISOString(), data: {} },
      null,
      0, // maxRetries=0 → single attempt, no exponential-backoff timers
      { allowPrivate: true }
    );

    assert.equal(res.success, false, "delivery should fail when the connection is refused");
    assert.equal(res.status, 0);
    assert.ok(abortTimerIds.size >= 1, "an abort timer should have been armed");
    // The regression guard: every armed abort timer must have been cleared,
    // even though the connection was refused.
    for (const id of abortTimerIds) {
      assert.ok(
        clearedIds.has(id),
        "abort timer must be cleared in finally even when the connection fails (no dangling 10s timer)"
      );
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});
