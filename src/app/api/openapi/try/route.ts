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

// #5 (confused deputy): mutating methods through this self-fetch proxy are only meaningful for the
// inference/agent surfaces. The /api/ management surface is GET/HEAD-only here, so the proxy can
// never be turned into a writer against host-sensitive management routes.
const MUTABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MUTABLE_ALLOWED_PREFIXES = ["/v1/", "/v1beta/", "/a2a", "/.well-known/"];
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

    // #5: never let the same-origin self-fetch reach host-sensitive (LOCAL_ONLY) or
    // always-protected routes — those rely on the caller's network locality / login, which the
    // server itself satisfies, turning this proxy into a confused deputy.
    if (isLocalOnlyPath(pathname, upperMethod) || isAlwaysProtectedPath(pathname)) {
      return NextResponse.json(
        { error: "Target endpoint is not available through Try It" },
        { status: 403 }
      );
    }

    // Mutating methods are only allowed against the inference/agent surfaces, never the /api/
    // management surface, through this proxy.
    if (
      MUTABLE_METHODS.has(upperMethod) &&
      !MUTABLE_ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      return NextResponse.json(
        { error: "Only GET/HEAD are allowed for this endpoint through Try It" },
        { status: 405 }
      );
    }

    const start = performance.now();

    // Forward only the caller-supplied headers (Cookie/Host/etc. are stripped by
    // buildForwardHeaders). The dashboard session cookie is intentionally NOT attached
    // implicitly (#5): credentials must be passed explicitly by the caller (e.g. Authorization).
    const forwardHeaders = buildForwardHeaders(headers as Record<string, string>);

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
