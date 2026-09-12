/**
 * Public-safe error bodies for the tunnel and MITM management routes.
 *
 * Hard Rule #12 forbids returning a raw `err.message` in an HTTP body, and
 * `sanitizeErrorMessage()` (open-sse/utils/errorSanitization.ts) is the repo's
 * general answer. Division of responsibility with it:
 *
 *   - Absolute filesystem paths — `.json`/`.yml` state files, extension-less
 *     binaries, Windows drives — are redacted by the shared sanitizer
 *     (`ENOENT ... open '/home/<user>/.omniroute/data/tunnels.json'`,
 *     `spawn /usr/local/bin/cloudflared ENOENT`). This module adds nothing there.
 *   - Tailscale auth keys (`invalid key tskey-auth-kMn3Qz7RtY-9fVbXsPq2LdWc`) are
 *     NOT in the shared credential vocabulary and would survive it verbatim.
 *
 * Because one shape still leaks through the shared sanitizer and these bodies
 * come from child processes (`cloudflared`, `tailscale`, `tailscaled`, `ngrok`)
 * and filesystem I/O on the operator's home directory, this module does not
 * echo a (sanitized) upstream message at all: it answers with a fixed sentence.
 * tests/unit/tunnel-routes-error-sanitization.test.ts pins which shapes the
 * shared sanitizer covers so this contract can be revisited when it grows.
 *
 * Reachability is not uniform. `/api/tunnels/ngrok` (both methods),
 * `/api/tunnels/tailscale` and `/api/tunnels/tailscale/check` are NOT in
 * `LOCAL_ONLY_API_PREFIXES`, and `GET /api/tunnels/cloudflared` is explicitly
 * exempted through `LOCAL_ONLY_API_GET_EXEMPTIONS` (#11531), so those bodies can
 * reach a non-loopback caller. The remaining tunnel routes and
 * `/api/settings/mitm` are loopback-gated; they are covered here for one
 * consistent contract, not because they are remotely reachable.
 *
 * The contract deliberately does NOT try to scrub the upstream text. It returns
 * a fixed operator-facing sentence plus a coarse machine-readable `reason`, and
 * logs the real error server-side where the operator can still read it.
 */

/** Coarse classification a client can branch on without seeing host details. */
export type PublicSafeTunnelErrorReason =
  "not_installed" | "permission_denied" | "already_running" | "timeout" | "network" | "unknown";

export interface PublicSafeTunnelErrorBody {
  error: string;
  reason: PublicSafeTunnelErrorReason;
}

/** Classify without echoing: only the reason label ever reaches the client. */
export function classifyTunnelError(error: unknown): PublicSafeTunnelErrorReason {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!raw) return "unknown";
  if (raw.includes("enoent") || raw.includes("not found") || raw.includes("not installed")) {
    return "not_installed";
  }
  if (
    raw.includes("eacces") ||
    raw.includes("eperm") ||
    raw.includes("permission denied") ||
    raw.includes("sudo") ||
    raw.includes("must be run as root")
  ) {
    return "permission_denied";
  }
  if (
    raw.includes("eaddrinuse") ||
    raw.includes("already running") ||
    raw.includes("already in use")
  ) {
    return "already_running";
  }
  if (raw.includes("etimedout") || raw.includes("timed out") || raw.includes("timeout")) {
    return "timeout";
  }
  if (
    raw.includes("econnrefused") ||
    raw.includes("econnreset") ||
    raw.includes("enotfound") ||
    raw.includes("network")
  ) {
    return "network";
  }
  return "unknown";
}

/**
 * Build the 500 body for a tunnel/MITM route.
 *
 * @param error    The caught value. Never echoed.
 * @param fallback Operator-facing sentence describing what failed. Must be a
 *                 literal owned by the route — never derived from `error`.
 * @param context  Short route label used only for the server-side log line.
 */
export function toPublicSafeTunnelError(
  error: unknown,
  fallback: string,
  context: string
): PublicSafeTunnelErrorBody {
  // The operator still needs the real cause; it belongs in the server log, not
  // in a body that may cross a tunnel.
  console.error(`[${context}]`, error);
  return { error: fallback, reason: classifyTunnelError(error) };
}
