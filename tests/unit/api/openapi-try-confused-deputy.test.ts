/**
 * Regression tests for finding #5 — OpenAPI "Try It" confused deputy.
 *
 * Proves the hardened proxy:
 *  - rejects LOCAL_ONLY destinations (host-sensitive routes) for every method,
 *  - rejects ALWAYS_PROTECTED destinations,
 *  - allows mutating methods only on the inference/agent surfaces (/v1, /v1beta, /a2a),
 *    never the /api/ management surface,
 *  - never attaches the dashboard session cookie implicitly to the self-fetch.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

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

function tryRequest(origin: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  return new Request(`${origin}/api/openapi/try`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/openapi/try — confused-deputy hardening", () => {
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

  it("rejects an ALWAYS_PROTECTED destination (/api/shutdown) with 403", async () => {
    const res = await tryRoute.POST(
      tryRequest("http://localhost", { method: "GET", path: "/api/shutdown" }) as never
    );
    assert.equal(res.status, 403);
  });

  it("rejects a mutating method against the /api/ management surface with 405", async () => {
    const res = await tryRoute.POST(
      tryRequest("http://localhost", {
        method: "DELETE",
        path: "/api/does-not-exist-xyz",
      }) as never
    );
    assert.equal(res.status, 405);
  });

  it("allows a mutating method against the inference surface (/v1/*) past the gates", async () => {
    // The self-fetch to /v1/... has no server in-test, so the handler's catch returns a 200
    // error envelope — the point is that it is NOT blocked (403/405) by the deputy gates.
    const res = await tryRoute.POST(
      tryRequest("http://localhost", {
        method: "POST",
        path: "/v1/chat/completions",
      }) as never
    );
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 405);
  });
});

describe("POST /api/openapi/try — does not forward the session cookie implicitly", () => {
  let server: Server;
  let seenCookie: string | undefined;
  let base = "";

  before(async () => {
    server = createServer((req, res) => {
      seenCookie = req.headers.cookie;
      res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does NOT attach the incoming dashboard cookie to the self-fetch", async () => {
    seenCookie = "SENTINEL";
    const res = await tryRoute.POST(
      tryRequest(base, { method: "GET", path: "/api/does-not-exist-xyz" }, "session=topsecret") as never
    );
    // The self-fetch reached our echo server (same-origin), and it must not have received a cookie.
    assert.equal(res.status, 200);
    assert.equal(seenCookie, undefined, "session cookie must not be forwarded implicitly");
  });
});
