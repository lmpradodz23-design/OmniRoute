/**
 * Regression tests for finding #6 — Electron remote renderer / privileged IPC.
 *
 * Pure guards (unit-tested without the Electron binary) + static assertions that main.js's
 * `login:start` handler applies the sender guard and never returns extracted credentials to the
 * renderer. The full window/preload split + navigation blocking is verified at runtime (Electron
 * E2E), which is out of scope for this unit suite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { isLoopbackHostname, isPrivilegedSenderAllowed, isCrossOriginNavigation } = require(
  "../../electron/lib/ipcOriginGuard"
);

describe("ipcOriginGuard.isLoopbackHostname", () => {
  it("recognizes loopback hosts", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "0.0.0.0", "app.localhost"]) {
      assert.equal(isLoopbackHostname(h), true, h);
    }
  });
  it("rejects non-loopback hosts", () => {
    for (const h of ["example.com", "192.168.1.5", "10.0.0.2", "omniroute.example.com"]) {
      assert.equal(isLoopbackHostname(h), false, h);
    }
  });
});

describe("ipcOriginGuard.isPrivilegedSenderAllowed", () => {
  it("allows the local renderer (loopback / file / packaged / unknown)", () => {
    for (const u of [
      "http://localhost:20128/",
      "https://127.0.0.1:8443/x",
      "file:///C:/app/index.html",
      "app://omniroute/index.html",
      "about:blank",
      "",
      undefined,
    ]) {
      assert.equal(isPrivilegedSenderAllowed(u), true, String(u));
    }
  });
  it("DENIES an explicit remote origin (the confused-deputy vector)", () => {
    for (const u of [
      "https://evil.example.com/",
      "http://192.168.1.50:3000/",
      "https://omniroute.dz23.online/home",
    ]) {
      assert.equal(isPrivilegedSenderAllowed(u), false, u);
    }
  });
});

describe("ipcOriginGuard.isCrossOriginNavigation", () => {
  it("flags cross-origin as blockable and allows same-origin", () => {
    assert.equal(
      isCrossOriginNavigation("http://localhost:20128/a", "http://localhost:20128/b"),
      false
    );
    assert.equal(
      isCrossOriginNavigation("http://localhost:20128/a", "https://evil.com/b"),
      true
    );
    assert.equal(isCrossOriginNavigation("http://localhost:20128/a", "not a url"), true);
    assert.equal(isCrossOriginNavigation("", "http://localhost:20128/a"), false);
  });
});

describe("main.js login:start hardening (static)", () => {
  const source = readFileSync(join(process.cwd(), "electron/main.js"), "utf8");
  const start = source.indexOf('ipcMain.handle("login:start"');
  const handler = source.slice(start, start + 2400);

  it("guards the sender frame before proceeding", () => {
    assert.ok(start !== -1, "login:start handler must exist");
    assert.ok(
      handler.includes("isPrivilegedSenderAllowed"),
      "login:start must reject a non-local sender"
    );
  });
  it("never returns extracted credentials to the renderer", () => {
    assert.ok(
      handler.includes("credentials: _omitCredentials") || handler.includes("safeResult"),
      "login:start must strip credentials from its return value"
    );
    // The old leak was a bare `return result;` that carried result.credentials.
    assert.ok(!/\breturn result;\s*}\s*\)/.test(handler), "no bare `return result;` leak");
  });
});
