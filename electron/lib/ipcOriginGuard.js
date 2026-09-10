"use strict";

/**
 * ipcOriginGuard.js — pure, testable guards for Electron IPC/navigation security (finding #6).
 *
 * The main window carries a privileged preload bridge (`electronAPI`, incl. `startLogin`). In
 * Remote Server mode the same window can load an operator-configured HTTP(S) origin, so a
 * remote/compromised page could call privileged IPC (and, before this fix, receive extracted
 * credentials). These guards let `main.js` reject privileged IPC from any non-local sender frame
 * and block cross-origin navigation of the privileged window.
 *
 * Extracted as pure functions (no `electron` import) so they can be unit-tested without the
 * Electron binary.
 */

/** True for loopback hostnames (the local embedded server / same machine). */
function isLoopbackHostname(hostname) {
  const h = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost")
  );
}

/**
 * Whether a privileged IPC call from `senderUrl` is allowed. Allowed for the local embedded
 * server (loopback) and for the packaged app's own `file:`/`app:` renderer. DENIED for any
 * explicit non-loopback http(s) origin (a remote/LAN page must never drive privileged IPC —
 * install/restart/login/credentials). An empty/unknown sender is treated as the local app
 * (fail-open only for the unknown-local case, never for an explicit remote origin).
 *
 * @param {string|null|undefined} senderUrl - `event.senderFrame?.url`
 * @returns {boolean}
 */
function isPrivilegedSenderAllowed(senderUrl) {
  const raw = String(senderUrl || "").trim();
  if (!raw) return true; // unknown → local packaged renderer; do not break the local app
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return true; // non-URL (e.g. "about:blank") → local context
  }
  const proto = parsed.protocol;
  // Only NETWORK origins can be remote: an http(s) non-loopback page is the attack surface, so
  // deny it. Every non-network scheme (file:, app:, about:, chrome:, devtools:, data:) is local
  // packaged content and stays privileged.
  if (proto === "http:" || proto === "https:") {
    return isLoopbackHostname(parsed.hostname);
  }
  return true;
}

/**
 * Whether navigating the privileged window from `fromUrl` to `toUrl` is a cross-origin move that
 * must be blocked (so the privileged preload window can't be steered onto an attacker origin).
 * A blank/unknown current origin allows the initial load.
 *
 * @param {string|null|undefined} fromUrl
 * @param {string|null|undefined} toUrl
 * @returns {boolean} true when the navigation is cross-origin and should be blocked
 */
function isCrossOriginNavigation(fromUrl, toUrl) {
  let to;
  try {
    to = new URL(String(toUrl));
  } catch {
    return true; // unparseable target → block
  }
  let from;
  try {
    from = new URL(String(fromUrl));
  } catch {
    return false; // no known current origin (initial load) → allow
  }
  return from.origin !== to.origin;
}

/**
 * Whether a navigation of the privileged window must be blocked (E-1). Cross-origin moves are
 * blocked — with one deliberate exception: loopback ↔ loopback (localhost / 127.0.0.1 / ::1 on
 * any port), because the embedded server may answer on another loopback spelling or port after
 * a restart. Main-process `loadURL` calls (mode switches, port changes) never emit
 * `will-navigate`, so Remote Server mode is unaffected. Unparseable targets are blocked; an
 * unknown current origin (initial load, about:blank) allows the navigation.
 *
 * @param {string|null|undefined} fromUrl - `webContents.getURL()`
 * @param {string|null|undefined} toUrl - the navigation target
 * @returns {boolean} true when the navigation must be prevented
 */
function shouldBlockNavigation(fromUrl, toUrl) {
  let to;
  try {
    to = new URL(String(toUrl));
  } catch {
    return true;
  }
  let from;
  try {
    from = new URL(String(fromUrl));
  } catch {
    return false;
  }
  if (from.protocol !== "http:" && from.protocol !== "https:") return false; // about:blank, file:
  if (from.origin === to.origin) return false;
  const bothLoopback =
    (to.protocol === "http:" || to.protocol === "https:") &&
    isLoopbackHostname(from.hostname) &&
    isLoopbackHostname(to.hostname);
  return !bothLoopback;
}

/**
 * IPC channels that act on the machine, the app lifecycle or credentials. Every one of them
 * must be registered through `withPrivilegedSender` (E-2). Informational channels
 * (`get-app-info`, `get-app-version`, `get-autostart-status`, `login:status`) and window
 * controls stay reachable so the dashboard keeps working in Remote Server mode.
 */
const PRIVILEGED_IPC_CHANNELS = Object.freeze([
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
]);

/**
 * The URL of the frame that sent an IPC message. `senderFrame` can be null once the frame is
 * gone; `sender.getURL()` (the WebContents) is the fallback. Unknown → "" (treated as local by
 * `isPrivilegedSenderAllowed`, never as remote).
 *
 * @param {{ senderFrame?: { url?: string } | null, sender?: { getURL?: () => string } } | undefined} event
 * @returns {string}
 */
function resolveSenderUrl(event) {
  const frameUrl = event && event.senderFrame && event.senderFrame.url;
  if (typeof frameUrl === "string" && frameUrl) return frameUrl;
  const sender = event && event.sender;
  if (sender && typeof sender.getURL === "function") {
    try {
      const url = sender.getURL();
      if (typeof url === "string") return url;
    } catch {
      /* destroyed WebContents → unknown */
    }
  }
  return "";
}

/**
 * Wrap an `ipcMain.handle`/`ipcMain.on` handler so a non-local sender frame is denied BEFORE
 * the handler runs (E-2). The denial value is URL-free (`{ success: false, error }` by
 * default; `onDenied(channel)` for fire-and-forget channels).
 *
 * @template {(...args: any[]) => any} H
 * @param {string} channel
 * @param {H} handler
 * @param {{ onDenied?: (channel: string) => unknown }} [options]
 * @returns {(event: unknown, ...args: unknown[]) => ReturnType<H> | unknown}
 */
function withPrivilegedSender(channel, handler, options = {}) {
  return (event, ...args) => {
    if (!isPrivilegedSenderAllowed(resolveSenderUrl(event))) {
      console.warn(`[Electron] Blocked privileged IPC "${channel}" from a remote sender`);
      return options.onDenied
        ? options.onDenied(channel)
        : { success: false, error: `${channel} is not available from a remote context` };
    }
    return handler(event, ...args);
  };
}

module.exports = {
  isLoopbackHostname,
  isPrivilegedSenderAllowed,
  isCrossOriginNavigation,
  shouldBlockNavigation,
  PRIVILEGED_IPC_CHANNELS,
  resolveSenderUrl,
  withPrivilegedSender,
};
