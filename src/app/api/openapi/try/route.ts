/**
 * API: OpenAPI "Try It" Proxy
 * POST — forwards a request to a local endpoint and returns the result
 */

import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { isLocalOnlyPath, isAlwaysProtectedPath } from "@/server/authz/routeGuard";

const ALLOWED_TRY_PATH_PREFIXES = ["/api/", "/v1/", "/v1beta/", "/a2a", "/.well-known/agent.json"];

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
    .refine((value) => !value.startsWith("//"), "Path must be a same-origin path")
    .refine(
      (value) => ALLOWED_TRY_PATH_PREFIXES.some((prefix) => value.startsWith(prefix)),
      "Path must target an OmniRoute API endpoint"
    ),
  headers: z.record(z.string(), z.string()).optional().default({}),
  body: z.any().optional(),
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

    const { method, path, headers, body: reqBody } = validation.data;

    const origin = getRequestOrigin(request);
    const targetUrl = new URL(path, origin);
    if (targetUrl.origin !== origin) {
      return NextResponse.json({ error: "Path must be same-origin" }, { status: 400 });
    }

    const upperMethod = method.toUpperCase();
    const pathname = targetUrl.pathname;

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

    const start = performance.now();

    // Forward cookies/auth from the original (already management-authenticated) request.
    const forwardHeaders = buildForwardHeaders(headers as Record<string, string>);

    // Forward auth from the dashboard session so the proxied call runs as the same admin.
    const cookie = request.headers.get("cookie");
    if (cookie && !forwardHeaders["Cookie"]) {
      forwardHeaders["Cookie"] = cookie;
    }

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

    const res = await fetch(targetUrl, fetchOptions);
    const latencyMs = Math.round(performance.now() - start);

    // Read response
    const contentType = res.headers.get("content-type") || "";
    let responseBody: any;

    if (contentType.includes("application/json")) {
      responseBody = await res.json();
    } else {
      const text = await res.text();
      // Truncate very large responses
      responseBody = text.length > 10000 ? text.slice(0, 10000) + "\n... (truncated)" : text;
    }

    // Collect response headers
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

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
