import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Final audit C-01: a second OmniRoute instance started on a non-default port
// (PORT=20413) still tried to bind the live WebSocket daemon to 20132. That
// port belonged to the operator's first instance, the bind failed
// (EADDRINUSE, #6324 keeps that non-fatal) and the second dashboard ended up
// dialling the FIRST instance's socket - which rightly refused its Origin.
//
// The auto-start must (a) fall back to a port derived from the instance's
// own runtime port when LIVE_WS_PORT is not explicit, and (b) publish the port
// it actually bound so the `/api/v1/ws?handshake=1` route announces it to the
// browser and in-process bridges reach the right daemon.
//
// Importing liveServer.ts is safe here: its auto-start guard is short-circuited
// by isBuildOrTest() (the node:test runner passes "--test" in process.argv).
const { resolveLiveWsPortPlan, autoStartLiveDashboardServer, LIVE_WS_DEFAULT_PORT } =
  await import("../../src/server/ws/liveServer.ts");

function eaddrinuse(port: number): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`listen EADDRINUSE: address already in use ${port}`);
  err.code = "EADDRINUSE";
  return err;
}

describe("resolveLiveWsPortPlan", () => {
  test("an explicit LIVE_WS_PORT is used as-is with no fallback", () => {
    const plan = resolveLiveWsPortPlan({ LIVE_WS_PORT: "31000", PORT: "20413" });
    assert.deepEqual(plan, { explicit: true, candidates: [31000] });
  });

  test("the default instance keeps the compiled-in default port only", () => {
    const plan = resolveLiveWsPortPlan({});
    assert.deepEqual(plan, { explicit: false, candidates: [LIVE_WS_DEFAULT_PORT] });
  });

  test("a non-default PORT adds a runtime-derived fallback after the default", () => {
    const plan = resolveLiveWsPortPlan({ PORT: "20413" });
    assert.equal(plan.explicit, false);
    assert.equal(plan.candidates[0], LIVE_WS_DEFAULT_PORT);
    assert.equal(plan.candidates.length, 2);
    const fallback = plan.candidates[1];
    assert.notEqual(fallback, LIVE_WS_DEFAULT_PORT);
    assert.notEqual(fallback, 20413);
    // Deterministic: the same configuration yields the same fallback so a
    // reconnecting browser tab keeps working across server restarts.
    assert.deepEqual(resolveLiveWsPortPlan({ PORT: "20413" }), plan);
  });

  test("OMNIROUTE_PORT (wrapped runtimes) drives the fallback like PORT does", () => {
    assert.deepEqual(
      resolveLiveWsPortPlan({ OMNIROUTE_PORT: "20413", PORT: "21288" }),
      resolveLiveWsPortPlan({ PORT: "20413" })
    );
  });

  test("a fallback that would collide with the instance's own listeners is skipped", () => {
    // PORT=20128 is the default → no fallback at all (the default WS port
    // already belongs to this instance's port family).
    assert.deepEqual(resolveLiveWsPortPlan({ PORT: "20128" }).candidates, [LIVE_WS_DEFAULT_PORT]);
    // The derived fallback never equals one of the HTTP listeners.
    const plan = resolveLiveWsPortPlan({ PORT: "20413", DASHBOARD_PORT: "20417" });
    for (const candidate of plan.candidates) {
      assert.notEqual(candidate, 20413);
      assert.notEqual(candidate, 20417);
    }
  });
});

describe("autoStartLiveDashboardServer", () => {
  test("binds the first candidate and publishes it as LIVE_WS_PORT when unset", async () => {
    const env: NodeJS.ProcessEnv = { PORT: "20413" };
    const attempts: number[] = [];
    const result = await autoStartLiveDashboardServer(env, async (port) => {
      attempts.push(port);
      return { port } as unknown as import("http").Server;
    });
    assert.deepEqual(attempts, [LIVE_WS_DEFAULT_PORT]);
    assert.equal(result.port, LIVE_WS_DEFAULT_PORT);
    assert.equal(env.LIVE_WS_PORT, String(LIVE_WS_DEFAULT_PORT));
  });

  test("falls back to the runtime-derived port when the default is already taken", async () => {
    const env: NodeJS.ProcessEnv = { PORT: "20413" };
    const plan = resolveLiveWsPortPlan(env);
    const attempts: number[] = [];
    const result = await autoStartLiveDashboardServer(env, async (port) => {
      attempts.push(port);
      if (port === LIVE_WS_DEFAULT_PORT) throw eaddrinuse(port);
      return { port } as unknown as import("http").Server;
    });
    assert.deepEqual(attempts, plan.candidates);
    assert.equal(result.port, plan.candidates[1]);
    // The handshake route and the in-process event bridge read LIVE_WS_PORT
    // at call time - the effective port must be visible to them.
    assert.equal(env.LIVE_WS_PORT, String(plan.candidates[1]));
  });

  test("an explicit LIVE_WS_PORT never falls back and keeps the operator's value", async () => {
    const env: NodeJS.ProcessEnv = { PORT: "20413", LIVE_WS_PORT: "31000" };
    const attempts: number[] = [];
    await assert.rejects(
      () =>
        autoStartLiveDashboardServer(env, async (port) => {
          attempts.push(port);
          throw eaddrinuse(port);
        }),
      (err: NodeJS.ErrnoException) => err.code === "EADDRINUSE"
    );
    assert.deepEqual(attempts, [31000]);
    assert.equal(env.LIVE_WS_PORT, "31000");
  });

  test("a non-EADDRINUSE bind failure is not retried on another port", async () => {
    const env: NodeJS.ProcessEnv = { PORT: "20413" };
    const attempts: number[] = [];
    await assert.rejects(
      () =>
        autoStartLiveDashboardServer(env, async (port) => {
          attempts.push(port);
          const err: NodeJS.ErrnoException = new Error("EACCES");
          err.code = "EACCES";
          throw err;
        }),
      (err: NodeJS.ErrnoException) => err.code === "EACCES"
    );
    assert.deepEqual(attempts, [LIVE_WS_DEFAULT_PORT]);
    assert.equal(env.LIVE_WS_PORT, undefined);
  });
});
