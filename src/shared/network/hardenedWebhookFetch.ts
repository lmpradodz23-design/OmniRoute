/**
 * Hardened outbound fetch for the webhook-test diagnostic path (SSRF finding #1).
 *
 * The generic `parseAndValidateWebhookUrl` only classifies the URL's hostname STRING and does
 * no DNS resolution, and plain `fetch` follows redirects — so a public hostname that either
 * (a) resolves to a private/metadata IP (DNS rebinding) or (b) 3xx-redirects to an internal
 * host reaches the server's network and its body can be exfiltrated. This module closes both:
 *
 *  1. Resolves A/AAAA and validates EVERY resolved address (metadata/link-local blocked
 *     unconditionally; private allowed only under the explicit opt-in) — classification uses the
 *     RESOLVED ip, not the hostname string.
 *  2. Pins the socket to the pre-validated ip via an undici dispatcher `lookup`, so DNS cannot
 *     rebind between validation and connect (TOCTOU). Host header / TLS SNI stay the hostname.
 *  3. Never follows redirects (`redirect: "manual"`; any 3xx is a blocked diagnostic, no body).
 *  4. Never returns the body of a private target (connectivity diagnostics only).
 *
 * Pure resolution/validation (`resolveAndAssertWebhookTarget`) accepts an injectable `lookup`
 * so DNS-rebinding classification is unit-testable without real DNS.
 */
import dnsp from "node:dns/promises";

import { Agent, fetch as undiciFetch } from "undici";

import { isRedirectStatus, rejectBlockedRedirect } from "./blockedRedirect";
import {
  CLOUD_METADATA_BLOCKED_MESSAGE,
  OutboundUrlGuardError,
  PROVIDER_URL_BLOCKED_MESSAGE,
  isCloudMetadataHost,
  isPrivateHost,
  parseOutboundUrl,
} from "./outboundUrlGuard";
import { ipVersion, normalizeHost } from "./privateHost";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface ResolvedWebhookTarget {
  url: URL;
  addresses: ResolvedAddress[];
  /** True when any resolved address is a private/LAN ip (opt-in must allow it to reach here). */
  isPrivateTarget: boolean;
}

export type WebhookLookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

type PinnedLookupCallback = (
  err: Error | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number
) => void;

/**
 * Dispatcher `connect.lookup` that pins the socket to the pre-validated address so DNS cannot
 * rebind between validation and connect. Node's `net.connect` (autoSelectFamily, on by default
 * since Node 20) calls it with `{ all: true }` and expects an ARRAY of `{ address, family }`;
 * the legacy form expects `(err, address, family)`. Both must be honoured — answering the `all`
 * form with a bare string fails every hostname target with "Invalid IP address: undefined".
 */
export function pinnedLookup(pinned: ResolvedAddress) {
  return (_hostname: string, options: unknown, callback: unknown) => {
    const cb = callback as PinnedLookupCallback;
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      (options as { all?: boolean }).all === true;
    if (wantsAll) {
      cb(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };
}

const nodeLookup: WebhookLookupFn = async (hostname) => {
  const recs = await dnsp.lookup(hostname, { all: true, verbatim: true });
  return recs.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * Resolve the target and assert every resolved address is an allowed egress. Throws
 * `OutboundUrlGuardError` on any metadata address, or on a private address without opt-in.
 */
export async function resolveAndAssertWebhookTarget(
  input: string | URL,
  opts: { lookup?: WebhookLookupFn; allowPrivate?: boolean } = {}
): Promise<ResolvedWebhookTarget> {
  // Protocol + embedded-credential checks only (no global feature-flag coupling — the private
  // decision is driven solely by `allowPrivate`, which the route derives from the opt-in).
  const url = parseOutboundUrl(input);
  const host = normalizeHost(url.hostname);
  const allowPrivate = opts.allowPrivate ?? false;

  // Hostname-string guards: metadata names (e.g. metadata.google.internal) and named-local /
  // literal-private hosts (localhost, *.local, 127.0.0.1, ::1, RFC1918 literals).
  if (isCloudMetadataHost(host)) {
    throw new OutboundUrlGuardError(CLOUD_METADATA_BLOCKED_MESSAGE, {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: host,
    });
  }
  if (isPrivateHost(host) && !allowPrivate) {
    throw new OutboundUrlGuardError(PROVIDER_URL_BLOCKED_MESSAGE, {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: host,
    });
  }

  const lookup = opts.lookup ?? nodeLookup;

  let addresses: ResolvedAddress[];
  const literalVersion = ipVersion(host);
  if (literalVersion !== 0) {
    addresses = [{ address: host, family: literalVersion }];
  } else {
    addresses = await lookup(host);
    if (addresses.length === 0) {
      throw new OutboundUrlGuardError(`No DNS records resolved for ${host}`, {
        code: "OUTBOUND_URL_INVALID",
        url: url.toString(),
        hostname: host,
      });
    }
  }

  let isPrivateTarget = false;
  for (const { address } of addresses) {
    // Cloud-metadata / link-local is NEVER a valid webhook target — even under the private opt-in.
    if (isCloudMetadataHost(address)) {
      throw new OutboundUrlGuardError(`${CLOUD_METADATA_BLOCKED_MESSAGE} (resolved address)`, {
        code: "OUTBOUND_URL_GUARD_BLOCKED",
        url: url.toString(),
        hostname: address,
      });
    }
    if (isPrivateHost(address)) isPrivateTarget = true;
  }

  if (isPrivateTarget && !allowPrivate) {
    throw new OutboundUrlGuardError(`${PROVIDER_URL_BLOCKED_MESSAGE} (resolved address)`, {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: host,
    });
  }

  return { url, addresses, isPrivateTarget };
}

export interface HardenedWebhookFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Allow private/LAN targets (opt-in). Metadata stays blocked regardless. */
  allowPrivate?: boolean;
  /** Injectable resolver for tests. */
  lookup?: WebhookLookupFn;
  maxBodyBytes?: number;
  /**
   * Withhold the response body of a private/LAN target (default `true`: connectivity
   * diagnostics only, never an internal service's content — the webhook-test contract).
   * Callers whose payload IS the body of an operator-configured private peer (an OIDC issuer
   * or a federation server on the LAN, admitted through `allowPrivate`) pass `false`.
   * Cloud-metadata targets stay blocked regardless of either flag.
   */
  withholdPrivateBody?: boolean;
}

export interface HardenedWebhookFetchResult {
  status: number;
  ok: boolean;
  /**
   * Empty for a private target when `withholdPrivateBody` is on (the default), or when there is
   * no body; otherwise the body, truncated to `maxBodyBytes`.
   */
  bodyText: string;
  isPrivateTarget: boolean;
}

type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;

/**
 * Body policy of the diagnostic response: withheld (cancelled unread) under the webhook-test
 * contract for a private target, otherwise read and truncated to `maxBodyBytes`.
 */
async function readDiagnosticBody(
  res: UndiciResponse,
  withhold: boolean,
  maxBodyBytes: number
): Promise<string> {
  if (withhold) {
    // Connectivity diagnostics only — never the body of an internal service.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return "";
  }
  const bodyText = await res.text();
  return bodyText.length > maxBodyBytes ? bodyText.slice(0, maxBodyBytes) + "…" : bodyText;
}

/**
 * Perform the hardened request: resolve+validate, pin the ip, block redirects, and withhold the
 * body of a private target. Throws `OutboundUrlGuardError` when the target (or a redirect hop) is
 * blocked, so callers can surface a diagnostic without leaking internal content.
 */
export async function hardenedWebhookFetch(
  input: string | URL,
  options: HardenedWebhookFetchOptions = {}
): Promise<HardenedWebhookFetchResult> {
  const {
    method = "POST",
    headers = {},
    body,
    timeoutMs = 10_000,
    allowPrivate = false,
    lookup,
    maxBodyBytes = 2048,
    withholdPrivateBody = true,
  } = options;

  const target = await resolveAndAssertWebhookTarget(input, { lookup, allowPrivate });
  const pinned = target.addresses[0];

  // Pin the socket to the pre-validated ip so DNS cannot rebind between the check above and
  // the connect below.
  const agent = new Agent({ connect: { lookup: pinnedLookup(pinned) } });

  // Manual timer (cleared in finally) instead of AbortSignal.timeout so no timer is left pending
  // after the request settles.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await undiciFetch(target.url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OmniRoute-Webhook/1.0",
        ...headers,
      },
      body,
      redirect: "manual",
      signal: controller.signal,
      dispatcher: agent,
    });

    // Never follow a redirect: the hop could point at an internal service the initial
    // validation never saw. Surface a blocked diagnostic and read no body.
    if (isRedirectStatus(res.status)) await rejectBlockedRedirect(res, method, target.url);

    const bodyText = await readDiagnosticBody(
      res,
      target.isPrivateTarget && withholdPrivateBody,
      maxBodyBytes
    );

    return { status: res.status, ok: res.ok, bodyText, isPrivateTarget: target.isPrivateTarget };
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => {});
  }
}
