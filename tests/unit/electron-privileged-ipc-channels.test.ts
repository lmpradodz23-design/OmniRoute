/**
 * Regression for finding E-2 (Fase 1 §1): only `login:start` applied the sender guard. In
 * Remote Server mode the privileged window loads an operator-configured http(s) origin, and
 * that page could still invoke `restart-server`, `download-update` / `install-update`,
 * `enable-autostart` / `disable-autostart`, `get-data-dir` and `open-external` through the
 * preload bridge.
 *
 * Contract: every privileged channel is registered through `withPrivilegedSender(channel, …)`
 * (pure, unit-tested here with fake events) which denies any non-local sender frame before the
 * handler runs. Informational channels (`get-app-info`, `get-app-version`, `get-autostart-status`,
 * `login:status`) and window controls stay reachable so the remote dashboard keeps working.
 *
 * main.js cannot be loaded without the Electron binary — its wiring is asserted statically;
 * runtime behaviour is covered by the packaged-app smoke in CI (NOT_RUN here).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const {
  withPrivilegedSender,
  PRIVILEGED_IPC_CHANNELS,
  resolveSenderUrl,
} = require("../../electron/lib/ipcOriginGuard");

const REMOTE = { senderFrame: { url: "https://omniroute.example.com/dashboard" } };
const LOCAL = { senderFrame: { url: "http://localhost:20128/dashboard" } };
const PACKAGED = { senderFrame: { url: "file:///C:/app/index.html" } };

describe("withPrivilegedSender (pure)", () => {
  it("runs the handler for a local / packaged sender and passes the arguments through", async () => {
    const seen: unknown[] = [];
    const wrapped = withPrivilegedSender(
      "restart-server",
      async (_event: unknown, ...args: unknown[]) => {
        seen.push(args);
        return { success: true };
      }
    );
    assert.deepEqual(await wrapped(LOCAL, "a", 1), { success: true });
    assert.deepEqual(await wrapped(PACKAGED), { success: true });
    assert.deepEqual(seen, [["a", 1], []]);
  });

  it("DENIES a remote sender without running the handler and returns a URL-free error", async () => {
    let ran = false;
    const wrapped = withPrivilegedSender("download-update", async () => {
      ran = true;
      return { success: true };
    });
    const result = await wrapped(REMOTE);
    assert.equal(ran, false);
    assert.deepEqual(result, {
      success: false,
      error: "download-update is not available from a remote context",
    });
  });

  it("falls back to event.sender.getURL() when senderFrame is gone, and denies a remote one", async () => {
    let ran = false;
    const wrapped = withPrivilegedSender("enable-autostart", () => {
      ran = true;
      return true;
    });
    const remoteViaSender = {
      senderFrame: null,
      sender: { getURL: () => "http://192.168.1.50:3000/" },
    };
    assert.deepEqual(wrapped(remoteViaSender), {
      success: false,
      error: "enable-autostart is not available from a remote context",
    });
    assert.equal(ran, false);
    assert.equal(resolveSenderUrl(remoteViaSender), "http://192.168.1.50:3000/");
  });

  it("supports a custom denial value for fire-and-forget (ipcMain.on) handlers", () => {
    let ran = false;
    const wrapped = withPrivilegedSender(
      "window-close",
      () => {
        ran = true;
      },
      { onDenied: () => undefined }
    );
    assert.equal(wrapped(REMOTE), undefined);
    assert.equal(ran, false);
  });

  it("lists the privileged channels (the set main.js must guard)", () => {
    for (const channel of [
      "restart-server",
      "check-for-updates",
      "download-update",
      "install-update",
      "enable-autostart",
      "disable-autostart",
      "get-data-dir",
      "open-external",
      "login:start",
      "login:cancel",
    ]) {
      assert.ok(PRIVILEGED_IPC_CHANNELS.includes(channel), `${channel} must be privileged`);
    }
    for (const channel of [
      "get-app-info",
      "get-app-version",
      "get-autostart-status",
      "login:status",
    ]) {
      assert.ok(!PRIVILEGED_IPC_CHANNELS.includes(channel), `${channel} stays informational`);
    }
  });
});

describe("main.js wires every privileged channel through withPrivilegedSender (static)", () => {
  const source = readFileSync(join(process.cwd(), "electron/main.js"), "utf8");

  for (const channel of PRIVILEGED_IPC_CHANNELS as string[]) {
    it(`guards ${channel}`, () => {
      const registration = new RegExp(
        `ipcMain\\.handle\\(\\s*"${channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*withPrivilegedSender\\(\\s*"${channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`
      );
      assert.match(
        source,
        registration,
        `${channel} must be registered via withPrivilegedSender("${channel}", …)`
      );
    });
  }

  it("imports the helper from ipcOriginGuard", () => {
    // Destructured import, possibly multi-line: `const { …, withPrivilegedSender, } = require(…)`.
    assert.match(source, /withPrivilegedSender[\s\S]{0,200}require\("\.\/lib\/ipcOriginGuard"\)/);
  });
});
