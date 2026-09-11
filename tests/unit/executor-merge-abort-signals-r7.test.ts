// R-7 (audit/02-ARCHITECTURE.md): mergeAbortSignals() attached an "abort" listener to each
// source signal and never removed it when the merged request settled normally. A
// long-lived signal (a session- or process-scoped AbortSignal reused across requests)
// therefore accumulated one closure per request for its whole lifetime — a slow memory
// leak that also kept every merged controller reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";

import { mergeAbortSignals } from "../../open-sse/executors/base.ts";

test("merging against a long-lived signal leaves no listener behind once the merged signals are dropped", async () => {
  const longLived = new AbortController();
  for (let i = 0; i < 500; i++) {
    const perRequest = new AbortController();
    const merged = mergeAbortSignals(longLived.signal, perRequest.signal);
    assert.equal(merged.aborted, false);
  }
  // Give any weak bookkeeping a tick; listeners registered the old way are strong.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    getEventListeners(longLived.signal, "abort").length,
    0,
    "a settled/dropped merged signal must not stay subscribed to the long-lived source"
  );
});

test("the merged signal still aborts with the reason of whichever source aborts first", () => {
  const a = new AbortController();
  const b = new AbortController();
  const merged = mergeAbortSignals(a.signal, b.signal);
  assert.equal(merged.aborted, false);
  b.abort(new Error("secondary aborted"));
  assert.equal(merged.aborted, true);
  assert.equal((merged.reason as Error).message, "secondary aborted");
  a.abort(new Error("late primary"));
  assert.equal((merged.reason as Error).message, "secondary aborted", "first reason wins");

  const already = new AbortController();
  already.abort(new Error("pre-aborted"));
  const mergedPre = mergeAbortSignals(already.signal, new AbortController().signal);
  assert.equal(mergedPre.aborted, true);
  assert.equal((mergedPre.reason as Error).message, "pre-aborted");
});
