/**
 * Regression tests for finding #5 — OpenAPI "Try It" confused deputy.
 *
 * Core fix: the same-origin self-fetch must never reach host-sensitive (LOCAL_ONLY) or
 * always-protected routes — those trust the caller's network locality / login, which the server
 * satisfies over loopback. Blocking the DESTINATION closes the escalation while preserving the
 * feature's legitimate use (an authenticated admin exercising ordinary management / inference
 * APIs, including mutations, under their own session — covered by
 * tests/unit/openapi-try-route.test.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-openapi-try-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../../src/lib/db/core.ts");
const { updateSettings } = await import("../../../src/lib/db/settings.ts");
await updateSettings({ requireLogin: false });

const tryRoute = await import("../../../src/app/api/openapi/try/route.ts");

after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tryRequest(origin: string, body: unknown): Request {
  return new Request(`${origin}/api/openapi/try`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/openapi/try — confused-deputy destination block (#5)", () => {
  it("rejects a LOCAL_ONLY destination (/api/mcp/*) with 403", async () => {
    const res = await tryRoute.POST(
      tryRequest("http://localhost", { method: "POST", path: "/api/mcp/tools" }) as never
    );
    assert.equal(res.status, 403);
  });

  it("rejects a LOCAL_ONLY destination (/api/services/*) with 403", async () => {
    const res = await tryRoute.POST(
      tryRequest("http://localhost", { method: "GET", path: "/api/services/restart" }) as never
    );
    assert.equal(res.status, 403);
  });

  it("rejects a LOCAL_ONLY spawn route (/api/cli-tools/runtime/*) even with a mutating method", async () => {
    const res = await tryRoute.POST(
      tryRequest("http://localhost", {
        method: "POST",
        path: "/api/cli-tools/runtime/foo",
      }) as never
    );
    assert.equal(res.status, 403);
  });

  it("rejects an ALWAYS_PROTECTED destination (/api/shutdown) with 403", async () => {
    const res = await tryRoute.POST(
      tryRequest("http://localhost", { method: "GET", path: "/api/shutdown" }) as never
    );
    assert.equal(res.status, 403);
  });

  it("does NOT block an ordinary (non-sensitive) /api/ route — the feature still works", async () => {
    // The self-fetch to a non-existent same-origin route fails, so the handler's catch returns a
    // 200 error envelope — the point is it is NOT blocked (403) by the deputy gate.
    const res = await tryRoute.POST(
      tryRequest("http://localhost", {
        method: "POST",
        path: "/api/does-not-exist-xyz",
      }) as never
    );
    assert.notEqual(res.status, 403);
  });
});
