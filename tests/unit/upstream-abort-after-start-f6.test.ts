// Fase 6 (compat-isolated E2E, "client cancellation"): after the upstream response STARTED,
// a client disconnect no longer reached the upstream request. executeWithUpstreamStartTimeout
// hands the executor a combined signal (caller signal + start timeout) and, as soon as
// execute() resolves — for a streaming call, when the response headers arrive — its finally
// block removed the caller→combined abort listener. The upstream fetch kept the combined
// signal, which nobody could abort any more, so a cancelled stream kept downloading (and
// billing) tokens to the end. Observed against an isolated instance: client abort at 268 ms,
// disconnect detected at 332 ms, mock upstream still sent all 40 chunks and never saw a close.
import test from "node:test";
import assert from "node:assert/strict";

import { executeWithUpstreamStartTimeout } from "../../open-sse/handlers/chatCore/upstreamTimeouts.ts";

const executor = { getTimeoutMs: () => 5_000 };

test("a caller abort AFTER the upstream started still aborts the signal the executor holds", async () => {
  const caller = new AbortController();
  let held: AbortSignal | null = null;

  const result = await executeWithUpstreamStartTimeout({
    executor,
    provider: "openai-compatible-compat",
    model: "test-model",
    signal: caller.signal,
    execute: async (signal) => {
      held = signal; // the executor passes this straight to fetch()
      return { response: new Response("headers arrived; body still streaming") };
    },
  });
  assert.ok(result.response instanceof Response);
  assert.ok(held, "executor received a signal");
  assert.equal(held!.aborted, false, "not aborted before the client leaves");

  caller.abort(new Error("client_disconnect"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(held!.aborted, true, "the upstream signal must follow the caller abort after start");
  assert.match(String((held!.reason as Error)?.message ?? held!.reason), /client_disconnect/);
});

test("the start timeout is still disarmed once the upstream responded", async () => {
  const caller = new AbortController();
  let held: AbortSignal | null = null;
  await executeWithUpstreamStartTimeout({
    executor: { getTimeoutMs: () => 30 },
    provider: "p",
    model: "m",
    signal: caller.signal,
    execute: async (signal) => {
      held = signal;
      return { response: new Response("ok") };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(held!.aborted, false, "no late timeout abort after a successful start");
});

test("a caller abort BEFORE the upstream started rejects and aborts the executor signal", async () => {
  const caller = new AbortController();
  let held: AbortSignal | null = null;
  const pending = executeWithUpstreamStartTimeout({
    executor,
    provider: "p",
    model: "m",
    signal: caller.signal,
    execute: (signal) =>
      new Promise((_, reject) => {
        held = signal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  caller.abort(new Error("gone"));
  await assert.rejects(pending, /gone|abort/i);
  assert.equal(held!.aborted, true);
});
