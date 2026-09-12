// U7 / J13 (audit/04-PRODUCT-GAPS.md): after "Restart", the sidebar reloaded the page on
// a fixed 3 s timer. When the server took longer (migrations, slow disk, Electron
// respawn) the reload landed on the browser's connection-refused page and the user was
// left thinking the restart had failed. Reload only once /api/health/ping answers again.
import test from "node:test";
import assert from "node:assert/strict";

import {
  waitForServerReady,
  waitForServerRestart,
} from "../../src/shared/utils/waitForServerReady.ts";

function fetchSequence(statuses: Array<number | Error>) {
  let index = 0;
  const calls: number[] = [];
  const fetchFn = async () => {
    const entry = statuses[Math.min(index, statuses.length - 1)];
    calls.push(index);
    index += 1;
    if (entry instanceof Error) throw entry;
    return { ok: entry >= 200 && entry < 300, status: entry } as Response;
  };
  return { fetchFn, calls };
}

test("resolves ready as soon as the health endpoint answers 2xx", async () => {
  const { fetchFn, calls } = fetchSequence([new Error("ECONNREFUSED"), 503, 200]);
  const ready = await waitForServerReady({
    fetchFn,
    intervalMs: 1,
    timeoutMs: 1000,
    url: "/api/health/ping",
  });
  assert.equal(ready, true);
  assert.equal(calls.length, 3, "polls until the first healthy answer, then stops");
});

test("gives up after the timeout instead of polling forever", async () => {
  const { fetchFn, calls } = fetchSequence([new Error("ECONNREFUSED")]);
  const started = Date.now();
  const ready = await waitForServerReady({ fetchFn, intervalMs: 5, timeoutMs: 40 });
  assert.equal(ready, false);
  assert.ok(Date.now() - started >= 35, "waited out the budget");
  assert.ok(calls.length >= 2 && calls.length < 40, `bounded polling (${calls.length} calls)`);
});

test("uses cache: no-store so a stale cached ping cannot fake readiness", async () => {
  let init: RequestInit | undefined;
  const fetchFn = async (_url: string, options?: RequestInit) => {
    init = options;
    return { ok: true, status: 200 } as Response;
  };
  await waitForServerReady({ fetchFn, intervalMs: 1, timeoutMs: 100 });
  assert.equal(init?.cache, "no-store");
});

test("waitForServerRestart waits for the old process to go down before declaring ready", async () => {
  // Old process still answering 200 twice, then down, then the new one comes up.
  const { fetchFn, calls } = fetchSequence([200, 200, new Error("ECONNREFUSED"), 503, 200]);
  const ready = await waitForServerRestart({
    fetchFn,
    intervalMs: 1,
    downTimeoutMs: 1000,
    timeoutMs: 1000,
  });
  assert.equal(ready, true);
  assert.equal(calls.length, 5, "did not reload onto the still-running old process");
});

test("waitForServerRestart proceeds to readiness when the process never appears to go down", async () => {
  const { fetchFn } = fetchSequence([200]);
  const ready = await waitForServerRestart({
    fetchFn,
    intervalMs: 1,
    downTimeoutMs: 20,
    timeoutMs: 100,
  });
  assert.equal(ready, true, "bounded: a fast in-place restart still reloads");
});
