/**
 * Regression for finding E-3 (Fase 1 §1): the main window relied on Electron's implicit
 * renderer sandbox (on by default since Electron 20 whenever nodeIntegration is off). The
 * privileged window must state it explicitly, alongside contextIsolation / nodeIntegration,
 * so a future option (e.g. nodeIntegrationInWorker) or an Electron default change cannot
 * silently drop the sandbox; the remote-server prompt window already did.
 *
 * preload.js only uses `contextBridge`, `ipcRenderer`, `process.platform` and the DOM —
 * all available to a sandboxed preload.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Electron main window webPreferences (static)", () => {
  const source = readFileSync(join(process.cwd(), "electron/main.js"), "utf8");
  const start = source.indexOf("const window = new BrowserWindow({");
  const block = source.slice(start, source.indexOf("});", start) + 3);

  it("declares the sandbox explicitly with contextIsolation on and nodeIntegration off", () => {
    assert.ok(start !== -1, "main window construction must exist");
    assert.match(block, /sandbox:\s*true/);
    assert.match(block, /contextIsolation:\s*true/);
    assert.match(block, /nodeIntegration:\s*false/);
    assert.match(block, /webviewTag:\s*false/);
  });

  it("preload.js stays sandbox-compatible (no Node built-ins beyond electron)", () => {
    const preload = readFileSync(join(process.cwd(), "electron/preload.js"), "utf8");
    const requires = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    assert.deepEqual(requires, ["electron"], "sandboxed preload may only require electron");
  });
});
