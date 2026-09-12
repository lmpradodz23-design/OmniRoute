// Network evidence for provider connection tests (final audit C-03). A thrown validation
// error is only a *transport* failure when the upstream provably never answered: undici's
// "fetch failed" sentence, an OS/undici cause code (ECONNREFUSED, ENOTFOUND, UND_ERR_*), or a
// TLS cause code/message. This module holds the readers for that evidence — cause-code
// walking, the "fetch failed" probe, the TLS/unreachable tables, host and timeout accessors —
// so `transport.ts` only decides WHICH typed failure the evidence adds up to.

const TLS_CAUSE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "HOSTNAME_MISMATCH",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const UNREACHABLE_REASON_TEXT: Readonly<Record<string, string>> = {
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset",
  EAI_AGAIN: "host not found",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  ENOTFOUND: "host not found",
  EPIPE: "connection closed",
  ETIMEDOUT: "connection timed out",
  UND_ERR_CONNECT_TIMEOUT: "connection timed out",
  UND_ERR_SOCKET: "connection closed",
};

/** First `code` found on the error, its `errors` (AggregateError) or its `cause` chain. */
export function readCauseCode(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const record = value as { code?: unknown; errors?: unknown; cause?: unknown };
  if (typeof record.code === "string" && record.code.trim()) return record.code.trim();
  if (Array.isArray(record.errors)) {
    for (const nested of record.errors) {
      const nestedCode = readCauseCode(nested, depth + 1);
      if (nestedCode) return nestedCode;
    }
  }
  return readCauseCode(record.cause, depth + 1);
}

// undici reports every socket-level failure as `TypeError: fetch failed` whose `cause`
// carries the OS/TLS code. `safeOutboundFetch` keeps that text as the wrapper's message
// (and the TypeError as its cause), so the sentence may sit at any depth of the chain.
function hasFetchFailedMessage(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 4) return false;
  const record = value as { message?: unknown; errors?: unknown; cause?: unknown };
  if (typeof record.message === "string" && /^fetch failed\b/i.test(record.message)) return true;
  if (
    Array.isArray(record.errors) &&
    record.errors.some((e) => hasFetchFailedMessage(e, depth + 1))
  ) {
    return true;
  }
  return hasFetchFailedMessage(record.cause, depth + 1);
}

// OS / undici / TLS cause codes that prove the upstream never answered.
function isNetworkCauseCode(code: string | null): boolean {
  if (!code) return false;
  if (Object.prototype.hasOwnProperty.call(UNREACHABLE_REASON_TEXT, code)) return true;
  if (TLS_CAUSE_CODES.has(code) || code === "EPROTO") return true;
  return /^(UND_ERR_|EAI_|ERR_SSL_|ERR_TLS_)/.test(code);
}

/**
 * `safeOutboundFetch` wraps WHATEVER `fetch` threw as NETWORK_ERROR — a proxy-patch error, a
 * body-parser throw, a test mock — so the category alone is not evidence that the host was
 * unreachable. Only undici's "fetch failed" or an OS/TLS cause code proves a transport failure.
 */
export function hasTransportEvidence(error: Error, causeCode: string | null): boolean {
  return hasFetchFailedMessage(error) || isNetworkCauseCode(causeCode);
}

export function isTlsCause(code: string | null, message: string): boolean {
  if (
    code &&
    (TLS_CAUSE_CODES.has(code) || code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_"))
  ) {
    return true;
  }
  if (code === "EPROTO") return /ssl|tls|certificate|handshake/i.test(message);
  return /self[- ]signed certificate|certificate has expired|unable to verify the first certificate|wrong version number|ssl3_|tlsv1/i.test(
    message
  );
}

/** Readable text for an unreachable cause code ("connection refused"); the raw code when unknown. */
export function describeUnreachableReason(code: string | null): string | null {
  return code ? UNREACHABLE_REASON_TEXT[code] || code : null;
}

export function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** The positive `timeoutMs` a timeout error carries (FetchTimeoutError / SafeOutboundFetchError), or null. */
export function readTimeoutMs(error: Error): number | null {
  const rawTimeout = (error as { timeoutMs?: unknown }).timeoutMs;
  return typeof rawTimeout === "number" && rawTimeout > 0 ? rawTimeout : null;
}

export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
