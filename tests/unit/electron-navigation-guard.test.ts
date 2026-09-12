/**
 * Regression for finding E-1 (Fase 1 §1): `isCrossOriginNavigation` existed but was never
 * attached to the privileged window — a page (or a server-side redirect) could steer the
 * window carrying the privileged preload bridge onto any origin.
 *
 * Contract: `shouldBlockNavigation(from, to)` (pure) blocks cross-origin moves except between
 * two loopback origins (the embedded server may answer on localhost / 127.0.0.1 / another
 * port after a restart), and main.js attaches it to BOTH `will-navigate` and `will-redirect`
 * with `event.preventDefault()`. Main-process `loadURL` calls (mode switches, port changes)
 * do not emit `will-navigate`, so Remote Server mode keeps working.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { shouldBlockNavigation } = require("../../electron/lib/ipcOriginGuard");

describe("shouldBlockNavigation (pure)", () => {
  it("allows same-origin navigation", () => {
    assert.equal(
      shouldBlockNavigation("http://localhost:20128/a", "http://localhost:20128/b"),
      false
    );
    assert.equal(
      shouldBlockNavigation("https://omniroute.example.com/a", "https://omniroute.example.com/b"),
      false
    );
  });

  it("allows loopback ↔ loopback even across hostname spelling or port (embedded server restarts)", () => {
    assert.equal(
      shouldBlockNavigation("http://localhost:20128/a", "http://127.0.0.1:20128/b"),
      false
    );
    assert.equal(
      shouldBlockNavigation("http://127.0.0.1:20128/a", "http://localhost:21288/b"),
      false
    );
    assert.equal(shouldBlockNavigation("http://localhost:20128/a", "http://[::1]:20128/b"), false);
  });

  it("BLOCKS navigation from a loopback origin to any remote origin", () => {
    assert.equal(
      shouldBlockNavigation("http://localhost:20128/a", "https://evil.example.com/"),
      true
    );
    assert.equal(
      shouldBlockNavigation("http://127.0.0.1:20128/a", "http://192.168.1.50:3000/"),
      true
    );
  });

  it("BLOCKS navigation between two different remote origins (redirect from the remote server)", () => {
    assert.equal(
      shouldBlockNavigation("https://omniroute.example.com/a", "https://evil.example.com/"),
      true
    );
    assert.equal(
      shouldBlockNavigation("https://omniroute.example.com/a", "http://localhost:20128/"),
      true
    );
  });

  it("blocks unparseable targets and allows the initial load (no current origin)", () => {
    assert.equal(shouldBlockNavigation("http://localhost:20128/a", "not a url"), true);
    assert.equal(shouldBlockNavigation("", "http://localhost:20128/a"), false);
    assert.equal(shouldBlockNavigation("about:blank", "https://omniroute.example.com/"), false);
  });
});

describe("main.js attaches the navigation guard to the privileged window (static)", () => {
  const source = readFileSync(join(process.cwd(), "electron/main.js"), "utf8");

  it("handles will-navigate and will-redirect with shouldBlockNavigation + preventDefault", () => {
    // One handler, attached to both events.
    const defIdx = source.indexOf("const blockCrossOriginNavigation = ");
    assert.ok(defIdx !== -1, "blockCrossOriginNavigation handler must exist");
    const body = source.slice(defIdx, defIdx + 600);
    assert.ok(
      body.includes("shouldBlockNavigation("),
      "handler must consult shouldBlockNavigation"
    );
    assert.ok(body.includes("event.preventDefault()"), "handler must preventDefault when blocked");
    for (const eventName of ["will-navigate", "will-redirect"]) {
      assert.match(
        source,
        new RegExp(`webContents\\.on\\(\\s*"${eventName}",\\s*blockCrossOriginNavigation\\s*\\)`),
        `${eventName} must be wired to blockCrossOriginNavigation`
      );
    }
  });

  it("keeps window.open denied (external links go to the OS browser only)", () => {
    const idx = source.indexOf("setWindowOpenHandler");
    assert.ok(idx !== -1);
    assert.ok(source.slice(idx, idx + 700).includes('return { action: "deny" }'));
  });
});
