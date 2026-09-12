/**
 * API: OpenAPI "Try It" Proxy
 * POST — forwards a request to a local endpoint and returns the result
 */

import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import {
  attachStoredApiKey,
  buildForwardFetchOptions,
  readProxiedResponse,
  rejectUnproxiableTarget,
} from "./tryProxyHelpers";

const BLOCKED_FORWARD_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const tryRequestSchema = z.object({
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
    .optional()
    .default("GET"),
  path: z
    .string()
    .min(1, "Path is required")
    .startsWith("/", "Path must start with /")
    .refine((value) => !value.startsWith("//"), "Path must be a same-origin path"),
  headers: z.record(z.string(), z.string()).optional().default({}),
  body: z.any().optional(),
  /** Required for POST/PUT/PATCH/DELETE — a deliberate act of the operator, never implied. */
  confirmMutation: z.boolean().optional().default(false),
  /**
   * #7 (reveal-once): one of the operator's own stored keys, injected as `Authorization`
   * SERVER-SIDE so the plaintext never travels to the browser. Ignored when the caller
   * supplies an explicit Authorization header.
   */
  apiKeyId: z.string().trim().min(1).max(128).optional(),
});

function getRequestOrigin(request: NextRequest) {
  return request.nextUrl?.origin || new URL(request.url).origin;
}

function buildForwardHeaders(headers: Record<string, string>) {
  const forwardHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey || BLOCKED_FORWARD_HEADERS.has(normalizedKey)) continue;
    forwardHeaders[key] = value;
  }

  return forwardHeaders;
}

export async function POST(request: NextRequest) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const rawBody = await request.json();
    const validation = validateBody(tryRequestSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { method, path, headers, body: reqBody, confirmMutation, apiKeyId } = validation.data;

    const origin = getRequestOrigin(request);
    const targetUrl = new URL(path, origin);
    if (targetUrl.origin !== origin) {
      return NextResponse.json({ error: "Path must be same-origin" }, { status: 400 });
    }

    const upperMethod = method.toUpperCase();
    const pathname = targetUrl.pathname;

    // #5: documented-operation allowlist, mutation confirmation, LOCAL_ONLY / protected guard.
    const rejection = rejectUnproxiableTarget(upperMethod, pathname, confirmMutation);
    if (rejection) return rejection;

    const start = performance.now();

    // #5 residual (no implicit credentials): the proxied call carries ONLY the headers the
    // operator typed into the panel (an explicit Authorization for the key under test). The
    // dashboard session cookie is never forwarded — the server must not act as the admin's
    // deputy; hop-by-hop / host headers and a caller-supplied Cookie are dropped as before.
    const forwardHeaders = buildForwardHeaders(headers as Record<string, string>);

    // #7 (reveal-once): a stored key named by id is attached server-side, never echoed back.
    const missingKey = await attachStoredApiKey(forwardHeaders, apiKeyId);
    if (missingKey) return missingKey;

    const fetchOptions = buildForwardFetchOptions(method, forwardHeaders, reqBody);

    const res = await fetch(targetUrl, fetchOptions);
    const latencyMs = Math.round(performance.now() - start);

    const { contentType, responseBody, responseHeaders } = await readProxiedResponse(res);

    return NextResponse.json({
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body: responseBody,
      latencyMs,
      contentType,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 0,
        statusText: "Network Error",
        headers: {},
        body: { error: sanitizeErrorMessage(error) || "Request failed" },
        latencyMs: 0,
        contentType: "application/json",
      },
      { status: 200 } // Return 200 so the frontend can display the error
    );
  }
}
