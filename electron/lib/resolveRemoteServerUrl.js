"use strict";

const fs = require("fs");

/**
 * resolveRemoteServerUrl.js — pure helper for resolving an operator-configured
 * remote OmniRoute server URL, so the Electron shell can attach to an
 * already-running instance (e.g. a Docker/OrbStack container, or a server on
 * another machine on the LAN) instead of spawning its own bundled Next.js
 * server.
 *
 * Some environments make the bundled local server impractical — for example,
 * a host that injects provider API keys via a secrets manager in a way the
 * packaged app's env-file loading doesn't expect. Running the real server in
 * an isolated container and pointing the desktop shell at it sidesteps that
 * entirely.
 *
 * Precedence:
 *   1. OMNIROUTE_REMOTE_URL env var (explicit, session-scoped override)
 *   2. `remoteServerUrl` key in <dataDir>/electron-preferences.json (persisted
 *      via the tray menu's "Connect to Remote Server…" prompt)
 *   3. null — caller falls back to spawning the local embedded server
 *
 * Extracted as a pure helper (env + fs injectable) so it can be unit-tested
 * without importing the full Electron main process (which requires the
 * Electron binary).
 *
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} opts.env - injectable process.env (for tests)
 * @param {string} opts.prefsPath - absolute path to electron-preferences.json
 * @param {(p: string) => boolean} [opts.existsSync] - injectable fs.existsSync
 * @param {(p: string, enc: string) => string} [opts.readFileSync] - injectable fs.readFileSync
 * @returns {string|null} the validated http(s) remote URL (no trailing slash), or null if none configured
 */
function resolveRemoteServerUrl({
  env,
  prefsPath,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
}) {
  const candidate = readCandidate({ env, prefsPath, existsSync, readFileSync });
  if (!candidate) return null;
  return isValidHttpUrl(candidate) ? stripTrailingSlash(candidate) : null;
}

function readCandidate({ env, prefsPath, existsSync, readFileSync }) {
  const fromEnv = (env.OMNIROUTE_REMOTE_URL || "").trim();
  if (fromEnv) return fromEnv;

  if (!prefsPath || !existsSync(prefsPath)) return null;
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
    const fromPrefs = typeof prefs.remoteServerUrl === "string" ? prefs.remoteServerUrl.trim() : "";
    return fromPrefs || null;
  } catch {
    // Corrupt/partial prefs file — fall back to spawning the local server
    // rather than crashing the app on startup.
    return null;
  }
}

/**
 * Hosts on which plain http:// is acceptable for the Remote Server URL: the
 * shell sends the operator's dashboard session and provider credentials to
 * this origin, so clear-text transport is only tolerated where the traffic
 * never leaves a private network — loopback, RFC1918 / CGNAT / link-local
 * ranges, `.local` / `.localhost` / `.internal` names and single-label host
 * names (Docker/OrbStack container names, a LAN box). Everything else must
 * be https://.
 *
 * @param {string} hostname - URL hostname (IPv6 literals without brackets)
 * @returns {boolean}
 */
function isPrivateNetworkHost(hostname) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "::") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host.startsWith("::ffff:")) return isPrivateNetworkHost(host.slice("::ffff:".length));

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (Tailscale & co.)
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }
  if (host.includes(":")) {
    // IPv6: unique-local (fc00::/7) and link-local (fe80::/10) only.
    return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  // Single-label name (no dot): only resolvable on the local network.
  return !host.includes(".");
}

/**
 * http(s) URL check for the Remote Server URL, with the transport policy of
 * finding E-4: https:// anywhere, http:// only on a private network.
 *
 * @param {string} candidate
 * @returns {boolean}
 */
function isValidHttpUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return isPrivateNetworkHost(parsed.hostname);
  } catch {
    return false;
  }
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

module.exports = { resolveRemoteServerUrl, isValidHttpUrl, isPrivateNetworkHost };
