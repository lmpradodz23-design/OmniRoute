/**
 * guardedFetch — the outbound client for operator-configured integration base URLs
 * (Obsidian, Qdrant, generic memory backends, Notion, Telegram, cloud agents, …; SSRF findings
 * S-5 / S-6 in audit/03-SECURITY-FINDINGS.md).
 *
 * Same egress properties as `hardenedWebhookFetch`, but it returns a real `Response`, so the
 * existing clients keep their own status / content-type / body handling untouched:
 *
 *  1. String-level checks before any I/O (scheme, embedded credentials, literal private and
 *     cloud-metadata hosts).
 *  2. A/AAAA resolution and validation of EVERY resolved address — cloud metadata is always
 *     blocked; private/LAN addresses only under `allowPrivate`, which defaults to the operator's
 *     private-URL opt-in (the policy every other guard in the app applies).
 *  3. The connection is pinned to the validated ip through an undici dispatcher `lookup`, so DNS
 *     cannot rebind between validation and connect (TOCTOU). Host header / TLS SNI stay the
 *     hostname.
 *  4. Redirects are never followed: a 3xx is an `OutboundUrlGuardError` (the hop was never
 *     validated).
 *  5. Time to response headers is bounded by `timeoutMs`; a caller-supplied `signal` is honored
 *     for the whole request, body included.
 *
 * Body size and body policy belong to the caller — by the time it reads the body the target has
 * already been admitted. The pinned dispatcher is closed when the body settles (end, error,
 * cancel), or by an unref'd backstop if the caller never reads it.
 *
 * `lookup` is injectable so DNS-rebinding classification is unit-testable without real DNS.
 */
import { Agent, fetch as undiciFetch } from "undici";

type GuardedFetchImpl = typeof undiciFetch;
let fetchImplForTest: GuardedFetchImpl | null = null;

/**
 * Test seam (mirrors proxyFetch.setTlsClientForTest): guardedFetch dispatches through undici
 * with a pinned dispatcher, so suites that stub globalThis.fetch never see its calls. Pass
 * null to restore the real transport. Never used by production code.
 */
export function __setGuardedFetchImplForTest(impl: GuardedFetchImpl | null): void {
  fetchImplForTest = impl;
}

import {
  pinnedLookup,
  resolveAndAssertWebhookTarget,
  type WebhookLookupFn,
} from "./hardenedWebhookFetch";
import { OutboundUrlGuardError } from "./outboundUrlGuard";
import { arePrivateProviderUrlsAllowed } from "./outboundUrlGuardPolicy";
import { normalizeHost } from "./privateHost";

export interface GuardedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  /** Caller cancellation; honored for the whole request including the body. */
  signal?: AbortSignal;
  /** Bound on the time to response headers. */
  timeoutMs?: number;
  /** Allow private/LAN targets. Defaults to the operator's private-URL opt-in. Metadata is never allowed. */
  allowPrivate?: boolean;
  /** Injectable resolver for tests. */
  lookup?: WebhookLookupFn;
}

/**
 * The subset an integration client accepts from its caller: only knobs that tune the guard
 * (never bypass it). `lookup` makes DNS-rebinding classification unit-testable; `allowPrivate`
 * pins the policy instead of consulting the operator's flags.
 */
export type GuardedNetworkOptions = Pick<GuardedFetchOptions, "lookup" | "allowPrivate">;

const DEFAULT_TIMEOUT_MS = 30_000;
/** Closes a pinned dispatcher whose response body the caller never consumed. */
const DISPATCHER_BACKSTOP_MS = 60_000;

export async function guardedFetch(
  input: string | URL,
  options: GuardedFetchOptions = {}
): Promise<Response> {
  const {
    method = "GET",
    headers = {},
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    lookup,
  } = options;
  const allowPrivate = options.allowPrivate ?? arePrivateProviderUrlsAllowed();

  // Throws OutboundUrlGuardError for a bad scheme, embedded credentials, a metadata host, or a
  // private host/address without the opt-in — always before any socket is opened.
  const target = await resolveAndAssertWebhookTarget(input, { lookup, allowPrivate });
  const pinned = target.addresses[0];

  // Pin the socket to the pre-validated ip so DNS cannot rebind between the check above and
  // the connect below.
  const agent = new Agent({ connect: { lookup: pinnedLookup(pinned) } });

  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let settled = false;
  let backstop: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (backstop) clearTimeout(backstop);
    signal?.removeEventListener("abort", onCallerAbort);
    agent.close().catch(() => {});
  };
  // If the request is aborted mid-body (caller signal), release the dispatcher too.
  controller.signal.addEventListener("abort", settle, { once: true });

  try {
    const res = await (fetchImplForTest ?? undiciFetch)(target.url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
      dispatcher: agent,
    });

    if (res.status >= 300 && res.status < 400) {
      // Never follow a redirect: the hop could point at an internal service the validation
      // never saw. Read no body.
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new OutboundUrlGuardError(
        `Redirect blocked for ${method} ${target.url.toString()} (${res.status})`,
        {
          code: "OUTBOUND_URL_GUARD_BLOCKED",
          url: target.url.toString(),
          hostname: normalizeHost(target.url.hostname),
        }
      );
    }

    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => responseHeaders.append(key, value));

    if (!res.body) {
      settle();
      return new Response(null, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      });
    }

    backstop = setTimeout(settle, DISPATCHER_BACKSTOP_MS);
    backstop.unref?.();

    // Keep the pinned dispatcher alive until the body settles (end, error or cancel), then
    // release it. A pull-based wrapper rather than a TransformStream: the DOM lib this project
    // typechecks against has no `cancel` hook on Transformer.
    const reader = res.body.getReader();
    const guardedBody = new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(streamController) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            streamController.close();
            settle();
            return;
          }
          streamController.enqueue(value as Uint8Array<ArrayBuffer>);
        } catch (error) {
          settle();
          streamController.error(error);
        }
      },
      cancel(reason) {
        settle();
        return reader.cancel(reason);
      },
    });

    return new Response(guardedBody, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    settle();
    throw error;
  } finally {
    // Only the time-to-headers bound is lifted here; the body keeps the caller's signal.
    clearTimeout(headerTimer);
  }
}
