/**
 * Helpers for the OpenAPI "Try It" proxy (`./route.ts`): the target-policy checks the
 * route applies before it self-fetches (documented-operation allowlist, mutation
 * confirmation, LOCAL_ONLY / always-protected guard), the server-side reveal-once key
 * injection, the forwarded fetch options and the proxied-response envelope.
 */

import { NextResponse } from "next/server";
import { isLocalOnlyPath, isAlwaysProtectedPath } from "@/server/authz/routeGuard";
import { isDocumentedOperation } from "@/lib/openapi/documentedOperations";
import { getApiKeyById } from "@/lib/db/apiKeys";

/** Methods that change state: the panel must confirm them explicitly (#5 residual). */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Upper bound on a non-JSON proxied body echoed back to the panel. */
const MAX_TEXT_RESPONSE_CHARS = 10000;

/**
 * Policy checks on the proxied destination, in order; the first refusal wins.
 * Returns the 403 to send, or `null` when the target may be proxied.
 */
export function rejectUnproxiableTarget(
  upperMethod: string,
  pathname: string,
  confirmMutation: boolean
): NextResponse | null {
  // #5 residual (explicit allowlist): only operations documented in docs/openapi.yaml —
  // the very catalog the panel renders — can be proxied. A generic /api/ prefix would admit
  // every undocumented or internal route.
  if (!isDocumentedOperation(upperMethod, pathname)) {
    return NextResponse.json(
      { error: "Target is not a documented OmniRoute endpoint" },
      { status: 403 }
    );
  }

  // #5 residual (mutations): state-changing methods need the operator's explicit confirmation.
  if (MUTATING_METHODS.has(upperMethod) && !confirmMutation) {
    return NextResponse.json(
      { error: "Mutating requests require confirmMutation: true" },
      { status: 403 }
    );
  }

  // #5 (confused deputy — core fix): never let the same-origin self-fetch reach host-sensitive
  // (LOCAL_ONLY) or always-protected routes. Those rely on the caller's network locality / login,
  // which the SERVER itself satisfies over loopback — so proxying them would let an authenticated
  // management caller (or, with requireLogin=false, an anonymous one) drive install/spawn/config
  // routes reserved for the local host. Blocking the destination closes the escalation while
  // preserving the feature's legitimate use (an authenticated admin exercising ordinary
  // management / inference APIs, including mutations, under their own session).
  if (isLocalOnlyPath(pathname, upperMethod) || isAlwaysProtectedPath(pathname)) {
    return NextResponse.json(
      { error: "Target endpoint is not available through Try It" },
      { status: 403 }
    );
  }

  return null;
}

/**
 * #7 (reveal-once): the panel names one of the operator's stored keys instead of
 * revealing it; the bearer is attached here and never echoed back. An explicit
 * Authorization header typed by the operator always wins. Returns the 404 to send
 * when the named key does not exist, `null` otherwise.
 */
export async function attachStoredApiKey(
  forwardHeaders: Record<string, string>,
  apiKeyId: string | undefined
): Promise<NextResponse | null> {
  const hasExplicitAuthorization = Object.keys(forwardHeaders).some(
    (key) => key.toLowerCase() === "authorization"
  );
  if (apiKeyId && !hasExplicitAuthorization) {
    const stored = await getApiKeyById(apiKeyId);
    if (!stored || typeof stored.key !== "string" || !stored.key) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    forwardHeaders["Authorization"] = `Bearer ${stored.key}`;
  }
  return null;
}

/** Fetch options for the self-fetch: JSON content type when a body is sent, body on non-GET only. */
export function buildForwardFetchOptions(
  method: string,
  forwardHeaders: Record<string, string>,
  reqBody: unknown
): RequestInit {
  if (reqBody && !forwardHeaders["Content-Type"]) {
    forwardHeaders["Content-Type"] = "application/json";
  }

  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers: forwardHeaders,
  };

  if (reqBody && method.toUpperCase() !== "GET") {
    fetchOptions.body = typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody);
  }

  return fetchOptions;
}

/** Reads the proxied response: JSON as-is, anything else as (truncated) text, plus its headers. */
export async function readProxiedResponse(res: Response): Promise<{
  contentType: string;
  responseBody: unknown;
  responseHeaders: Record<string, string>;
}> {
  const contentType = res.headers.get("content-type") || "";
  let responseBody: unknown;

  if (contentType.includes("application/json")) {
    responseBody = await res.json();
  } else {
    const text = await res.text();
    // Truncate very large responses
    responseBody =
      text.length > MAX_TEXT_RESPONSE_CHARS
        ? text.slice(0, MAX_TEXT_RESPONSE_CHARS) + "\n... (truncated)"
        : text;
  }

  // Collect response headers
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return { contentType, responseBody, responseHeaders };
}
