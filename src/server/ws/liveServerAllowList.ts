/**
 * liveServerAllowList — extract of the host/origin allow-list logic from
 * `src/server/ws/liveServer.ts`.
 *
 * Lives in its own module so unit tests can exercise it without booting the
 * full WebSocket server. The behaviour here MUST match the one used by the
 * connection handler exactly.
 *
 * Bug #1 (plans/2026-06-23-omniroute-v3.8.34-deep-audit.md) added the
 * `LIVE_WS_ALLOWED_HOSTS` opt-in for LAN/Tailscale deployments.
 */

import { getRuntimePorts } from "@/lib/runtime/ports";

const DEFAULT_HOST = "127.0.0.1";

/**
 * Loopback hosts a browser can show the dashboard on. The dashboard's WS
 * Origin is exactly `http://<one of these>:<listener port>`.
 *
 * 0.0.0.0 is the "unspecified" address but browsers treat it as loopback when
 * the user pastes it into the address bar; the dashboard is reachable at
 * http://0.0.0.0:<port> and its WS Origin is exactly that string. Same
 * local-only posture as the others — it never refers to a LAN host.
 */
const LOOPBACK_ORIGIN_HOSTS: readonly string[] = Object.freeze([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "0.0.0.0",
]);

/**
 * Origins allowed to open a WebSocket against the local dashboard, derived
 * from the ports this instance actually listens on (`PORT` / `OMNIROUTE_PORT`,
 * `API_PORT`, `DASHBOARD_PORT` — see `src/lib/runtime/ports.ts`).
 *
 * Final audit C-01: the list used to be a compiled-in `…:20128` quartet, so an
 * instance started on any other port (tray, `PORT=`, Docker) refused its own
 * dashboard with FORBIDDEN_ORIGIN and the client reconnected forever. Every
 * configured listener is a page the browser can be on when it opens the live
 * socket, so each one is an allowed Origin — on loopback hosts only.
 */
export function deriveLoopbackOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const ports = getRuntimePorts(env);
  const uniquePorts = [...new Set([ports.port, ports.apiPort, ports.dashboardPort])];
  const origins: string[] = [];
  for (const port of uniquePorts) {
    for (const host of LOOPBACK_ORIGIN_HOSTS) {
      origins.push(`http://${host}:${port}`);
    }
  }
  return origins;
}

/**
 * The origins allowed when nothing is configured (default port 20128 for
 * every listener). Kept as a frozen constant because tests and docs pin it.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze(deriveLoopbackOrigins({}));

/**
 * Parse a comma-separated env value into a set of trimmed, non-empty entries.
 * Centralized so tests can exercise empty / whitespace / dup behaviour.
 */
export function parseCsvEnv(value: string | undefined | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Build the static origin allow-list: the loopback origins of this instance's
 * configured listeners + the explicit LIVE_WS_ALLOWED_ORIGINS extension.
 */
export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = parseCsvEnv(env.LIVE_WS_ALLOWED_ORIGINS);
  return new Set([...deriveLoopbackOrigins(env), ...extra]);
}

/**
 * Build the host-based allow-list (LAN/Tailscale extension).
 */
export function buildAllowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return parseCsvEnv(env.LIVE_WS_ALLOWED_HOSTS);
}

/**
 * Parse the host portion of an Origin URL.
 *
 * Returns `null` when the input is not a well-formed absolute URL — callers
 * should treat `null` as "not a match".
 */
export function originHost(origin: string): { host: string; hostname: string } | null {
  try {
    const url = new URL(origin);
    return { host: url.host, hostname: url.hostname };
  } catch {
    return null;
  }
}

/**
 * Whether the given Origin's host (or `host:port`) is in the host
 * allow-list. Returns false when the list is empty.
 */
export function originHostMatches(origin: string, allowedHosts: Set<string>): boolean {
  if (allowedHosts.size === 0) return false;
  const parsed = originHost(origin);
  if (!parsed) return false;
  return allowedHosts.has(parsed.host) || allowedHosts.has(parsed.hostname);
}

/**
 * Top-level Origin allow decision. The contract:
 *
 *   - When `origin` is undefined (no Origin header, e.g. CLI/MCP), we only
 *     accept the request when the WS listener is bound to loopback. This
 *     prevents drive-by LAN clients from omitting Origin to bypass the
 *     browser-side check.
 *
 *   - When `origin` is present, we accept it if it matches an entry in the
 *     static origin list (defaults + LIVE_WS_ALLOWED_ORIGINS) or if its
 *     host matches an entry in the LAN allow-list (LIVE_WS_ALLOWED_HOSTS).
 */
export function isOriginAllowed(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options: { allowedOrigins?: Set<string>; allowedHosts?: Set<string> } = {}
): boolean {
  const allowedOrigins = options.allowedOrigins ?? buildAllowedOrigins(env);
  const allowedHosts = options.allowedHosts ?? buildAllowedHosts(env);

  if (!origin) {
    const host = env.LIVE_WS_HOST || DEFAULT_HOST;
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
  }
  if (allowedOrigins.has(origin)) return true;
  if (originHostMatches(origin, allowedHosts)) return true;
  return false;
}
