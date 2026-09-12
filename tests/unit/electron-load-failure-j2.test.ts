// J2 (audit/04-PRODUCT-GAPS.md): when the embedded server was not reachable at the
// moment the dashboard window loaded (slow migrations, port still binding, crash before
// listen) the privileged window stayed on Chromium's blank connection-refused page with
// no message and no retry. The main process must classify `did-fail-load` and recover.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const {
  ERR_ABORTED,
  shouldRecoverFromLoadFailure,
  buildLoadFailurePage,
  createLoadFailureRecovery,
} = require("../../electron/lib/loadFailure");

describe("Electron load-failure recovery (J2)", () => {
  it("recovers only main-frame, non-aborted failures of the app origin", () => {
    const serverUrl = "http://localhost:20128";
    assert.equal(
      shouldRecoverFromLoadFailure({
        errorCode: -102, // ERR_CONNECTION_REFUSED
        isMainFrame: true,
        validatedURL: "http://localhost:20128/dashboard",
        serverUrl,
      }),
      true
    );
    assert.equal(
      shouldRecoverFromLoadFailure({
        errorCode: ERR_ABORTED,
        isMainFrame: true,
        validatedURL: "http://localhost:20128/",
        serverUrl,
      }),
      false,
      "ERR_ABORTED is emitted for navigations we cancel ourselves"
    );
    assert.equal(
      shouldRecoverFromLoadFailure({
        errorCode: -102,
        isMainFrame: false,
        validatedURL: "http://localhost:20128/iframe",
        serverUrl,
      }),
      false,
      "sub-frame failures are the page's business"
    );
    assert.equal(
      shouldRecoverFromLoadFailure({
        errorCode: -102,
        isMainFrame: true,
        validatedURL: "https://example.com/",
        serverUrl,
      }),
      false,
      "foreign origins are not retried against our server"
    );
  });

  it("renders a self-contained error page with the description escaped", () => {
    const html = buildLoadFailurePage({
      serverUrl: "http://localhost:20128",
      errorDescription: '<img src=x onerror="alert(1)">',
      errorCode: -102,
    });
    assert.match(html, /<!doctype html>/i);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /localhost:20128/);
    assert.doesNotMatch(html, /<script/i, "no script: the page is static, recovery is in main");
  });

  // C-11: the tray already followed the OS locale (pt / en, English fallback) but this
  // waiting page was hard-wired to English with lang="en".
  it("renders the waiting page in Portuguese for a pt-* OS locale", () => {
    const html = buildLoadFailurePage({
      serverUrl: "http://localhost:20128",
      errorDescription: "ERR_CONNECTION_REFUSED",
      errorCode: -102,
      locale: "pt-BR",
    });
    assert.match(html, /<html lang="pt">/);
    assert.match(html, /Aguardando o servidor do OmniRoute/);
    assert.match(html, /reaberta automaticamente|recarrega automaticamente/);
    assert.doesNotMatch(html, /Waiting for the OmniRoute server/);
    assert.match(html, /localhost:20128/);
    assert.match(html, /ERR_CONNECTION_REFUSED \(-102\)/);
    assert.doesNotMatch(html, /<script/i);
  });

  it("falls back to English (lang=en) for unsupported or missing locales", () => {
    for (const locale of [undefined, "fr-FR", "", null]) {
      const html = buildLoadFailurePage({
        serverUrl: "http://localhost:20128",
        errorDescription: "x",
        errorCode: -102,
        locale,
      });
      assert.match(html, /<html lang="en">/, `locale=${String(locale)}`);
      assert.match(html, /Waiting for the OmniRoute server/);
    }
  });

  it("recovery uses getLocale() so the page shown to the operator is localized", () => {
    const loaded = [];
    const window = {
      isDestroyed: () => false,
      loadURL: async (url) => {
        loaded.push(url);
      },
    };
    const recovery = createLoadFailureRecovery({
      getWindow: () => window,
      getServerUrl: () => "http://localhost:20128",
      getLocale: () => "pt_PT",
      waitForServer: async () => false,
      logFn: () => {},
    });
    recovery.handle({
      errorCode: -102,
      errorDescription: "x",
      validatedURL: "http://localhost:20128/",
      isMainFrame: true,
    });
    assert.equal(loaded.length, 1);
    const page = decodeURIComponent(loaded[0].replace(/^data:text\/html;charset=utf-8,/, ""));
    assert.match(page, /<html lang="pt">/);
    assert.match(page, /Aguardando o servidor do OmniRoute/);
  });

  it("reloads the server URL once readiness returns, and shows the page meanwhile", async () => {
    const loaded = [];
    const window = {
      destroyed: false,
      isDestroyed() {
        return this.destroyed;
      },
      loadURL: async (url) => {
        loaded.push(url);
      },
    };
    let resolveReady;
    const readiness = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const recovery = createLoadFailureRecovery({
      getWindow: () => window,
      getServerUrl: () => "http://localhost:20128",
      waitForServer: () => readiness,
      logFn: () => {},
    });

    const first = recovery.handle({
      errorCode: -102,
      errorDescription: "ERR_CONNECTION_REFUSED",
      validatedURL: "http://localhost:20128/",
      isMainFrame: true,
    });
    const second = recovery.handle({
      errorCode: -102,
      errorDescription: "ERR_CONNECTION_REFUSED",
      validatedURL: "http://localhost:20128/",
      isMainFrame: true,
    });
    assert.equal(first, true);
    assert.equal(second, false, "a second failure while recovering does not stack pollers");
    assert.equal(loaded.length, 1);
    assert.match(loaded[0], /^data:text\/html;charset=utf-8,/);

    resolveReady(true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(loaded.slice(1), ["http://localhost:20128"]);
    assert.equal(recovery.isRecovering(), false);
  });

  it("does not reload a destroyed window and gives up after a readiness timeout", async () => {
    const loaded = [];
    const window = {
      destroyed: false,
      isDestroyed() {
        return this.destroyed;
      },
      loadURL: async (url) => {
        loaded.push(url);
      },
    };
    const recovery = createLoadFailureRecovery({
      getWindow: () => window,
      getServerUrl: () => "http://localhost:20128",
      waitForServer: async () => false,
      logFn: () => {},
    });
    recovery.handle({
      errorCode: -102,
      errorDescription: "x",
      validatedURL: "http://localhost:20128/",
      isMainFrame: true,
    });
    window.destroyed = true;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loaded.length, 1, "only the error page was loaded");
    assert.equal(recovery.isRecovering(), false);
  });
});
