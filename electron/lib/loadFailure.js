/**
 * Recovery for `webContents` `did-fail-load` in the privileged dashboard window (J2).
 *
 * Without this, a server that is not listening yet (long first-launch migrations, port
 * still binding, crash before listen) left the window on Chromium's blank
 * connection-refused page with no message and no retry. The main process now shows a
 * static, script-free explanation and reloads the dashboard once readiness returns.
 *
 * Pure helpers — no Electron import at module level — so the rules are unit-testable.
 * The only Electron access is the guarded, lazy `defaultGetLocale()` below, which is a
 * no-op outside an Electron process.
 */

const { resolveTrayLocale } = require("./trayStrings");

// Chromium net error for navigations cancelled by us (a newer loadURL, window close…).
const ERR_ABORTED = -3;

// C-11: the waiting page follows the OS locale exactly like the tray (pt / en, English
// fallback via resolveTrayLocale). The copy lives here rather than in TRAY_STRINGS because
// it is page prose, not menu labels; keep every key present in every locale.
const LOAD_FAILURE_STRINGS = {
  en: {
    title: "Waiting for the OmniRoute server…",
    body: "The dashboard at {target} is not answering yet. This is normal on the first launch (database setup) — the window reloads automatically as soon as the server is ready.",
    advice:
      "If this takes more than a few minutes, quit from the tray icon and open OmniRoute again.",
  },
  pt: {
    title: "Aguardando o servidor do OmniRoute…",
    body: "O painel em {target} ainda não está respondendo. Isso é normal na primeira abertura (preparação do banco de dados) — a janela recarrega automaticamente assim que o servidor estiver pronto.",
    advice:
      "Se isso demorar mais do que alguns minutos, saia pelo ícone da bandeja e abra o OmniRoute novamente.",
  },
};

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Recover only main-frame failures of OUR origin that were not cancelled on purpose.
 * Sub-frame and foreign-origin failures belong to the page, and ERR_ABORTED is the normal
 * echo of a navigation the main process itself superseded.
 */
function shouldRecoverFromLoadFailure({ errorCode, isMainFrame, validatedURL, serverUrl }) {
  if (!isMainFrame) return false;
  if (errorCode === ERR_ABORTED) return false;
  if (!validatedURL || !serverUrl) return false;
  return sameOrigin(validatedURL, serverUrl);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Page copy for an OS locale ("pt-BR", "pt_PT", "en-US", undefined…) — English fallback. */
function resolveLoadFailureStrings(locale) {
  const lang = resolveTrayLocale(locale);
  const strings = Object.prototype.hasOwnProperty.call(LOAD_FAILURE_STRINGS, lang)
    ? LOAD_FAILURE_STRINGS[lang]
    : LOAD_FAILURE_STRINGS.en;
  return { lang: strings === LOAD_FAILURE_STRINGS.en ? "en" : lang, strings };
}

/** Static, script-free page shown while the main process polls for readiness. */
function buildLoadFailurePage({ serverUrl, errorDescription, errorCode, locale }) {
  const detail = escapeHtml(`${errorDescription || "unknown error"} (${errorCode})`);
  const target = escapeHtml(serverUrl);
  const { lang, strings } = resolveLoadFailureStrings(locale);
  const body = escapeHtml(strings.body).replace("{target}", `<code>${target}</code>`);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>OmniRoute</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0a0a0a;color:#e5e5e5;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  main{max-width:520px;padding:32px;text-align:center}
  h1{font-size:20px;margin:0 0 8px}
  p{margin:8px 0;color:#a3a3a3}
  code{color:#e5e5e5;background:#1a1a1a;padding:2px 6px;border-radius:4px}
  .spin{width:28px;height:28px;border:3px solid #333;border-top-color:#8b5cf6;border-radius:50%;
        margin:0 auto 16px;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
</style></head>
<body><main>
  <div class="spin" aria-hidden="true"></div>
  <h1>${escapeHtml(strings.title)}</h1>
  <p>${body}</p>
  <p>${escapeHtml(strings.advice)}</p>
  <p><small>${detail}</small></p>
</main></body></html>`;
}

/**
 * OS locale when running inside Electron (after "ready"); undefined elsewhere so unit
 * tests never touch the `electron` package (whose index.js resolves the binary on load).
 */
function defaultGetLocale() {
  if (!process.versions || !process.versions.electron) return undefined;
  try {
    // eslint-disable-next-line global-require -- lazy on purpose, see the header comment
    const { app } = require("electron");
    return app && typeof app.getLocale === "function" && app.isReady()
      ? app.getLocale()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stateful recovery bound to a window getter. `handle(details)` returns true when a
 * recovery was started for this failure; a failure that arrives while one is already in
 * progress is ignored (no stacked pollers).
 */
function createLoadFailureRecovery({
  getWindow,
  getServerUrl,
  waitForServer,
  getLocale = defaultGetLocale,
  readinessTimeoutMs = 300000,
  logFn = console.log,
}) {
  let recovering = false;

  const handle = ({ errorCode, errorDescription, validatedURL, isMainFrame }) => {
    const serverUrl = getServerUrl();
    if (!shouldRecoverFromLoadFailure({ errorCode, isMainFrame, validatedURL, serverUrl })) {
      return false;
    }
    if (recovering) return false;
    recovering = true;
    logFn(
      `[Electron] Dashboard failed to load (${errorDescription} ${errorCode}); waiting for the server`
    );

    const window = getWindow();
    if (window && !window.isDestroyed()) {
      let locale;
      try {
        locale = getLocale();
      } catch {
        locale = undefined;
      }
      const page = buildLoadFailurePage({ serverUrl, errorDescription, errorCode, locale });
      void window
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
        .catch(() => {});
    }

    Promise.resolve(waitForServer(serverUrl, readinessTimeoutMs))
      .then((ready) => {
        const current = getWindow();
        if (ready && current && !current.isDestroyed()) {
          logFn("[Electron] Server reachable again; reloading the dashboard");
          return current.loadURL(getServerUrl());
        }
        if (!ready) logFn("[Electron] Server did not come back within the readiness budget");
        return undefined;
      })
      .catch(() => {})
      .finally(() => {
        recovering = false;
      });
    return true;
  };

  return { handle, isRecovering: () => recovering };
}

module.exports = {
  ERR_ABORTED,
  LOAD_FAILURE_STRINGS,
  buildLoadFailurePage,
  createLoadFailureRecovery,
  shouldRecoverFromLoadFailure,
};
