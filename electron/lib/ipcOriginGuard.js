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

module.exports = { isLoopbackHostname, isPrivilegedSenderAllowed, isCrossOriginNavigation };
