// Outbound fetch wrappers for provider validation: proxy-fallback, SSRF-aware proxy targeting, and
// error→result mapping. Extracted from validation.ts (god-file decomposition) and kept as the
// common boundary for sanitizing validation failures.
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/errorSanitization.ts";
import {
  SAFE_OUTBOUND_FETCH_PRESETS,
  SafeOutboundFetchError,
  getSafeOutboundFetchErrorStatus,
  safeOutboundFetch,
} from "@/shared/network/safeOutboundFetch";
import { isPrivateHost } from "@/shared/network/outboundUrlGuard";
import { getProviderValidationGuard } from "@/shared/network/outboundUrlGuardPolicy";
import { selectProxyForValidation } from "@omniroute/open-sse/services/proxyAutoSelector.ts";

export type ProjectedProviderValidationResult<T> = {
  [K in keyof T]: K extends "error" | "warning" ? string | null : T[K];
} & {
  error?: string | null;
  warning?: string | null;
};

export function projectProviderValidationResultForPublicResponse<
  T extends { error?: unknown; warning?: unknown },
>(result: T): ProjectedProviderValidationResult<T>;
export function projectProviderValidationResultForPublicResponse(
  result: Record<string, unknown>
): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...result };
  for (const field of ["error", "warning"] as const) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    const value = result[field];
    projected[field] = value === null || value === undefined ? null : sanitizeErrorMessage(value);
  }
  return projected;
}

/**
 * Wrapped fetch call that auto-retries with a proxy when the direct connection
 * fails.  This happens transparently so individual validators don't need to
 * think about proxy fallback.
 */
export async function fetchWithProxyFallback(
  url: string,
  init: RequestInit,
  presets: typeof SAFE_OUTBOUND_FETCH_PRESETS.validationRead,
  isLocal: boolean
): Promise<Response> {
  try {
    return await safeOutboundFetch(url, {
      ...presets,
      guard: isLocal ? "none" : getProviderValidationGuard(),
      ...init,
    });
  } catch (err: unknown) {
    // Only attempt proxy fallback for retryable errors (network / timeout)
    // and only when the target is not a local / LAN address.
    const fetchErr = err as SafeOutboundFetchError;
    const isNetworkIssue = fetchErr?.code === "NETWORK_ERROR" || fetchErr?.code === "TIMEOUT";
    const isRetryable = fetchErr?.isRetryable !== false;
    const isValidTarget = !isLocal && isRetryableProxyTarget(url);

    if (isLocal || !isNetworkIssue || !isRetryable) throw err;
    if (!isValidTarget) throw err;

    const proxyUrl = await selectProxyForValidation(url);
    if (!proxyUrl) throw err;

    return safeOutboundFetch(url, {
      ...presets,
      guard: isLocal ? "none" : getProviderValidationGuard(),
      ...init,
      proxyConfig: proxyUrl,
    });
  }
}

export function isRetryableProxyTarget(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Never proxy-fallback to a private/link-local/metadata host. Delegates to
    // the canonical SSRF guard (covers 169.254, 0.0.0.0, 172.16/12, CGNAT,
    // IPv6 fc/fd/fe80, .internal — gaps the previous inline check missed).
    return !isPrivateHost(hostname);
  } catch {
    return false;
  }
}

export async function validationRead(url: string, init: RequestInit, isLocal: boolean = false) {
  return fetchWithProxyFallback(url, init, SAFE_OUTBOUND_FETCH_PRESETS.validationRead, isLocal);
}

export async function validationWrite(url: string, init: RequestInit, isLocal: boolean = false) {
  return fetchWithProxyFallback(url, init, SAFE_OUTBOUND_FETCH_PRESETS.validationWrite, isLocal);
}

// A validation failure should only be flagged `securityBlocked` (which the route
// surfaces as a `provider.validation.ssrf_blocked` audit event + a security warning in
// the UI) when it is a GENUINE SSRF/guard block — not for every outbound-guard 503.
// A blocked redirect (REDIRECT_BLOCKED) to a PUBLIC host is benign: the redirect was
// never followed, so no SSRF occurred. Some web-cookie providers answer their probe
// with a 307 to a public host, which used to be mislabeled as an SSRF block (#3288 /
// #3758). Only treat a blocked redirect as a security event when its target is a
// private/internal host.
export function isSecurityBlockError(error: unknown): boolean {
  if (!(error instanceof SafeOutboundFetchError)) return false;
  if (error.code === "URL_GUARD_BLOCKED" || error.code === "INVALID_URL") return true;
  if (error.code === "REDIRECT_BLOCKED") {
    if (!error.location) return false;
    try {
      return isPrivateHost(new URL(error.location, error.url).hostname);
    } catch {
      return false;
    }
  }
  return false;
}

// #7542 — web-cookie providers whose registry `baseUrl` is a POST-only streaming/completion
// endpoint (no real `/models` listing API), so the generic `/models` probe in
// validateWebCookieProvider() gets a redirect instead of a definitive 200/401/403. A blocked
// redirect there is not a session-expiry signal — the endpoint just isn't shaped for the probe
// — so it should degrade to "unsupported" the same way the discovery path already does for
// REDIRECT_BLOCKED (#6267's buildDiscoveryErrorFallbackResponse).
//
// Scoped to `lmarena` only (root-caused and regression-tested for #7542): the other web-cookie
// providers sharing a POST-only baseUrl shape (doubao-web, huggingchat, yuanbao-web,
// zenmux-free, zai-web) have not been individually verified to actually redirect on this probe
// rather than 404/405 — do not add them here without a proven repro per provider (see
// #7542 plan-file, "Risks").
const WEB_COOKIE_PROVIDERS_WITH_UNRELIABLE_MODELS_PROBE = new Set(["lmarena"]);

// #7857 — web-cookie providers whose registry `baseUrl` is a conversation/completion
// endpoint, not a real API root (e.g. huggingchat's baseUrl is
// "https://huggingface.co/chat/conversation", not "https://huggingface.co"). Appending
// `/models` to these produces a path the upstream never served, so its status
// (200/404/405/429/redirect/login-HTML) carries no meaningful auth signal — it is NOT
// distinguishable from a genuinely valid session. A 401/403 from the same probe IS still
// treated as a real SESSION_EXPIRED signal (some of these hosts auth-gate every path,
// including nonexistent ones), so providers here still get probed; only the non-401/403
// branch is short-circuited to the honest "unsupported" result instead of `valid: true`.
// lmarena is deliberately NOT in this set — it already degrades via the
// WEB_COOKIE_PROVIDERS_WITH_UNRELIABLE_MODELS_PROBE/REDIRECT_BLOCKED path above (#7542).
export const WEB_COOKIE_PROVIDERS_WITHOUT_MODELS_API = new Set([
  "huggingchat",
  "grok-web",
  "notion-web",
  "t3-web",
  "yuanbao-web",
  "copilot-web",
  "copilot-m365-web",
]);

// #12107 — web-cookie providers whose registry entry exists to publish a model catalog
// (so `/v1/models` and `/v1/providers/{id}/models` list something) but whose `baseUrl`
// is a browser console, not an API host. gemini-business's entry points at
// business.gemini.google/home: the executor only uses that origin to derive a
// per-tenant StreamGenerate path (`/home/cid/{CID}/_/BardChatUi/...`), so there is no
// side-effect-free auth probe on the host — `${baseUrl}/models` is a page Google never
// served, and a 401/403 from a console page is not a credential signal either. Unlike
// WEB_COOKIE_PROVIDERS_WITHOUT_MODELS_API these providers are therefore not probed at
// all: validation stays the honest "unsupported" it reported before the registry entry
// existed, decided BEFORE any network call.
export const WEB_COOKIE_PROVIDERS_WITHOUT_AUTH_PROBE = new Set(["gemini-business"]);

export function toWebCookieValidationErrorResult(provider: string, error: unknown) {
  if (
    error instanceof SafeOutboundFetchError &&
    error.code === "REDIRECT_BLOCKED" &&
    WEB_COOKIE_PROVIDERS_WITH_UNRELIABLE_MODELS_PROBE.has(provider)
  ) {
    return {
      valid: false,
      error: "Provider validation not supported",
      unsupported: true as const,
    };
  }
  return toValidationErrorResult(error);
}

// Final audit C-03 — transport-level failures of a connection test (the upstream never
// answered) are reported with a typed code, the host that was dialed, and a readable
// English sentence instead of the raw undici/fetch text. The route forwards `code`,
// `host` and `timeoutMs` into `diagnosis` so the dashboard can translate the sentence.
// The message deliberately names only the host (never the full URL or a filesystem
// path), so it survives `sanitizeErrorMessage` intact.
export type ValidationTransportErrorCode =
  "UPSTREAM_TIMEOUT" | "UPSTREAM_UNREACHABLE" | "UPSTREAM_TLS";

export type ValidationTransportFailure = {
  code: ValidationTransportErrorCode;
  host: string | null;
  message: string;
  timeoutMs: number | null;
  /** Short OS/TLS cause code (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED, …) when known. */
  reason: string | null;
};

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

function readCauseCode(value: unknown, depth = 0): string | null {
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

function isTlsCause(code: string | null, message: string): boolean {
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

function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** Classify a thrown validation error as a typed transport failure, or null when it is not one. */
export function describeValidationTransportFailure(
  error: unknown
): ValidationTransportFailure | null {
  try {
    if (!(error instanceof Error)) return null;
    const outbound = error instanceof SafeOutboundFetchError ? error : null;
    if (outbound && outbound.code !== "TIMEOUT" && outbound.code !== "NETWORK_ERROR") return null;
    const host = hostOf(outbound?.url ?? (error as { url?: unknown }).url);
    const where = host ?? "the provider";
    // The wrapper's own `code` is the outbound category (NETWORK_ERROR, …); the OS/TLS
    // cause code lives in its cause chain. A bare error may carry the code itself.
    const causeCode = readCauseCode(outbound ? outbound.cause : error);
    const message = typeof error.message === "string" ? error.message : "";

    if (outbound?.code === "TIMEOUT" || error.name === "FetchTimeoutError") {
      const rawTimeout = (error as { timeoutMs?: unknown }).timeoutMs;
      const timeoutMs = typeof rawTimeout === "number" && rawTimeout > 0 ? rawTimeout : null;
      const after = timeoutMs ? ` after ${formatSeconds(timeoutMs)} s` : "";
      return {
        code: "UPSTREAM_TIMEOUT",
        host,
        timeoutMs,
        reason: null,
        message: `Could not connect to ${where}: timed out${after}. Check the URL and that the service is running.`,
      };
    }

    // `safeOutboundFetch` wraps WHATEVER `fetch` threw as NETWORK_ERROR — a proxy-patch
    // error, a body-parser throw, a test mock — so the category alone is not evidence
    // that the host was unreachable. Only undici's "fetch failed" or an OS/TLS cause
    // code proves a transport failure; anything else keeps its own (sanitized) message
    // and its HTTP semantics, instead of being presented as "Could not connect to …".
    const tls = isTlsCause(causeCode, message);
    if (!tls && !hasFetchFailedMessage(error) && !isNetworkCauseCode(causeCode)) return null;

    if (tls) {
      const detail = causeCode ? ` (${causeCode})` : "";
      return {
        code: "UPSTREAM_TLS",
        host,
        timeoutMs: null,
        reason: causeCode,
        message: `TLS handshake with ${where} failed${detail}. Check the certificate and the https:// URL.`,
      };
    }

    const reasonText = causeCode ? UNREACHABLE_REASON_TEXT[causeCode] || causeCode : null;
    const detail = reasonText ? ` (${reasonText})` : "";
    return {
      code: "UPSTREAM_UNREACHABLE",
      host,
      timeoutMs: null,
      reason: causeCode,
      message: `Could not connect to ${where}${detail}. Check the URL and that the service is running.`,
    };
  } catch {
    // Classification is advisory; hostile accessors must not escape the safe error boundary.
    return null;
  }
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

export function toValidationErrorResult(error: unknown) {
  let rawMessage: unknown = error || "Validation failed";
  try {
    if (error instanceof Error) rawMessage = error.message;
  } catch {
    rawMessage = "Validation failed";
  }
  const message = sanitizeErrorMessage(rawMessage);
  let statusCode: number | null = null;
  let timeout = false;
  let securityBlocked = false;
  let transport: ValidationTransportFailure | null = null;
  try {
    statusCode = getSafeOutboundFetchErrorStatus(error);
    timeout = error instanceof SafeOutboundFetchError && error.code === "TIMEOUT";
    securityBlocked = isSecurityBlockError(error);
    transport = describeValidationTransportFailure(error);
  } catch {
    // Classification is advisory; hostile accessors must not escape the safe error boundary.
  }

  return {
    valid: false,
    error: transport ? sanitizeErrorMessage(transport.message) : message || "Validation failed",
    unsupported: false as const,
    ...(statusCode ? { statusCode } : {}),
    ...(timeout ? { timeout: true } : {}),
    ...(securityBlocked ? { securityBlocked: true } : {}),
    ...(transport
      ? {
          code: transport.code,
          host: transport.host,
          ...(transport.timeoutMs ? { timeoutMs: transport.timeoutMs } : {}),
        }
      : {}),
  };
}
