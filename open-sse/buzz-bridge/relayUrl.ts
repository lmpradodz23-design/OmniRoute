/**
 * Buzz Bridge — relay URL guard (audit B-M2 / B-L5 / B-L3).
 *
 * Single gate for EVERY relay URL source (dashboard PUT, `BUZZ_RELAY_URL`, persisted override).
 * Fail-closed and spelling-insensitive: parsed with WHATWG `URL`, then
 *  - scheme must be `ws:` or `wss:`;
 *  - no userinfo (credentials would leak into status/logs), no query, no fragment;
 *  - cloud-metadata endpoints (169.254.169.254, fd00:ec2::254, metadata.google.internal, …) are
 *    ALWAYS rejected — the classic SSRF → IAM-credential pivot;
 *  - private/LAN hosts are rejected except loopback (the local buzz-relay dev setup);
 *  - TLS (`wss://`) is mandatory beyond loopback: a Nostr AUTH exchange over plain `ws://` on a
 *    LAN would expose the signed challenge and every event in clear.
 *
 * Reuses the shared host classification (`isPrivateHost` / `isCloudMetadataHost`) so the verdicts
 * match the outbound fetch guard used everywhere else.
 */
import { isCloudMetadataHost, isPrivateHost } from "@/shared/network/outboundUrlGuard";

export type BuzzRelayUrlErrorCode =
  | "invalid_url"
  | "unsupported_scheme"
  | "credentials_in_url"
  | "query_or_fragment"
  | "cloud_metadata_host"
  | "private_host"
  | "tls_required";

export type BuzzRelayUrlCheck =
  { ok: true; url: string } | { ok: false; code: BuzzRelayUrlErrorCode; message: string };

type RelayUrlRejection = Extract<BuzzRelayUrlCheck, { ok: false }>;

/** Longest URL we are willing to parse; longer input is noise, not a relay. */
const MAX_RELAY_URL_LENGTH = 2048;

function fail(code: BuzzRelayUrlErrorCode, message: string): RelayUrlRejection {
  return { ok: false, code, message };
}

/** Loopback spellings the bridge accepts over plain `ws://` (local relay for development). */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "::ffff:127.0.0.1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/** Syntax gate: parseable, ws/wss, no userinfo, no query/fragment, has a host. */
function parseRelayUrl(input: string): URL | RelayUrlRejection {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail("invalid_url", "relayUrl must be a ws:// or wss:// URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return fail("unsupported_scheme", "relayUrl must use ws:// (loopback only) or wss://");
  }
  if (url.username || url.password) {
    return fail("credentials_in_url", "relayUrl must not embed credentials");
  }
  if (url.search || url.hash || /[?#]/.test(input)) {
    return fail("query_or_fragment", "relayUrl must not carry a query string or fragment");
  }
  if (!url.hostname) return fail("invalid_url", "relayUrl must name a host");
  return url;
}

/** Host policy: metadata always blocked; private blocked unless loopback; TLS beyond loopback. */
function checkRelayHost(url: URL): RelayUrlRejection | null {
  const hostname = url.hostname;
  if (isCloudMetadataHost(hostname)) {
    return fail("cloud_metadata_host", "relayUrl must not point at a cloud-metadata endpoint");
  }
  if (isLoopbackHost(hostname)) return null;
  if (isPrivateHost(hostname)) {
    return fail("private_host", "relayUrl must be a public relay or a loopback address");
  }
  if (url.protocol !== "wss:") {
    return fail("tls_required", "relayUrl must use wss:// beyond loopback");
  }
  return null;
}

/**
 * Validate a relay URL. Returns the trimmed input on success (never a re-serialised form, so the
 * operator sees exactly what they configured). Messages never echo the input.
 */
export function validateBuzzRelayUrl(raw: string): BuzzRelayUrlCheck {
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input || input.length > MAX_RELAY_URL_LENGTH) {
    return fail("invalid_url", "relayUrl must be a ws:// or wss:// URL");
  }
  const parsed = parseRelayUrl(input);
  if (!(parsed instanceof URL)) return parsed;
  return checkRelayHost(parsed) ?? { ok: true, url: input };
}
