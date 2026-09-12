/**
 * MCP HTTP Transport Layer — session-aware handlers for SSE and Streamable HTTP.
 *
 * Runs the MCP server **inside** the Next.js process so it can be toggled
 * from the dashboard without requiring `omniroute --mcp`.
 *
 * Transport modes:
 *   - SSE:             GET /api/mcp/sse (event stream)  +  POST /api/mcp/sse (messages)
 *   - Streamable HTTP: POST /api/mcp/stream (messages)  +  GET /api/mcp/stream (SSE stream)  +  DELETE /api/mcp/stream (session end)
 */

import { randomUUID } from "node:crypto";
import { createMcpServer } from "./server.ts";
import { resolveMcpCallerAuthInfo, withMcpHttpAuthContext } from "./httpAuthContext.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// R-9: every HTTP client — on /api/mcp/sse or /api/mcp/stream — gets its own McpServer +
// transport keyed by mcp-session-id. The former shared "sse" singleton was reset by ANY
// client's `initialize` and its creation closed every Streamable HTTP session (and vice
// versa), so two MCP clients kept knocking each other offline.
type McpHttpSessionKind = "sse" | "streamable-http";

type McpHttpSession = {
  sessionId: string;
  kind: McpHttpSessionKind;
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  startedAt: number;
  lastActivityAt: number;
};

const _sessions = new Map<string, McpHttpSession>();
/** Most recent SSE session — fallback for legacy SSE clients that omit mcp-session-id. */
let _lastSseSessionId: string | null = null;

const MCP_SESSION_IDLE_MS = 5 * 60 * 1000;
/** Upper bound on live sessions; the least recently active one is evicted beyond it. */
const MCP_MAX_HTTP_SESSIONS = 64;

const _mcpSessionSweep = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of _sessions) {
    if (now - session.lastActivityAt > MCP_SESSION_IDLE_MS) {
      try {
        closeSession(sessionId);
      } catch {}
    }
  }
}, 60_000);
if (typeof _mcpSessionSweep === "object" && "unref" in _mcpSessionSweep) {
  (_mcpSessionSweep as { unref?: () => void }).unref?.();
}

function closeSession(sessionId: string): void {
  const session = _sessions.get(sessionId);
  if (!session) {
    return;
  }

  try {
    session.transport.close();
  } catch {
    // ignore shutdown errors
  }
  _sessions.delete(sessionId);
  if (_lastSseSessionId === sessionId) {
    _lastSseSessionId = null;
  }
}

function closeAllSessions(): void {
  for (const sessionId of [..._sessions.keys()]) {
    closeSession(sessionId);
  }
}

function evictLeastRecentlyActiveSession(): void {
  let victim: McpHttpSession | null = null;
  for (const session of _sessions.values()) {
    if (!victim || session.lastActivityAt < victim.lastActivityAt) victim = session;
  }
  if (victim) {
    console.warn(
      `[MCP] HTTP session cap (${MCP_MAX_HTTP_SESSIONS}) reached; evicting idle ${victim.kind}:${victim.sessionId}`
    );
    closeSession(victim.sessionId);
  }
}

function createSession(kind: McpHttpSessionKind): McpHttpSession {
  if (_sessions.size >= MCP_MAX_HTTP_SESSIONS) {
    evictLeastRecentlyActiveSession();
  }

  const sessionId = randomUUID();
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });
  const session: McpHttpSession = {
    sessionId,
    kind,
    server,
    transport,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  void server.connect(transport);
  _sessions.set(sessionId, session);
  if (kind === "sse") {
    _lastSseSessionId = sessionId;
  }
  console.log(`[MCP] HTTP transport started (${kind}:${sessionId})`);
  return session;
}

function closeStreamableSession(sessionId: string): void {
  closeSession(sessionId);
}

function createStreamableSession(): McpHttpSession {
  return createSession("streamable-http");
}
async function isInitializeRequest(request: Request): Promise<boolean> {
  if (request.method !== "POST") {
    return false;
  }

  try {
    const body = (await request.clone().json()) as RpcRequest | RpcRequest[];
    // A batched JSON-RPC body may carry the initialize entry (#10772).
    return Array.isArray(body)
      ? body.some((entry) => entry?.method === "initialize")
      : body?.method === "initialize";
  } catch {
    return false;
  }
}

/**
 * Resolve the caller's per-key scopes (#7895) and hand the request to the
 * transport with `authInfo` populated, so `extra.authInfo.scopes` reaching
 * tool handlers reflects the real `api_keys.scopes` row instead of the
 * `OMNIROUTE_MCP_SCOPES` env fallback. When no per-key auth can be resolved
 * (no key, invalid key, stdio has no `Request` at all), `authInfo` stays
 * `undefined` and `scopeEnforcement.ts` falls through to its existing
 * meta/env chain unchanged.
 */
async function handleRequestWithAuthInfo(
  transport: WebStandardStreamableHTTPServerTransport,
  request: Request
): Promise<Response> {
  const authInfo = await resolveMcpCallerAuthInfo(request);
  return transport.handleRequest(request, { authInfo });
}

function errorResponse(message: string, code: number, status = 400): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function protectMcpSseResponse(request: Request, response: Response): Response {
  if (
    request.method !== "POST" ||
    !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  const cacheControl = headers.get("cache-control");
  if (!/(?:^|,)\s*no-transform(?:\s*(?:,|$))/i.test(cacheControl ?? "")) {
    headers.set("cache-control", [cacheControl, "no-transform"].filter(Boolean).join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withSessionHeader(response: Response, sessionId: string): Response {
  if (response.headers.get("mcp-session-id")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("mcp-session-id", sessionId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleStreamableRequest(request: Request): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId) {
    const session = _sessions.get(sessionId);
    if (!session) {
      // MCP spec (2025-03-26 / 2025-11-25, Session Management): once a session is
      // terminated/unknown, the server MUST respond with HTTP 404 Not Found so the
      // client re-initializes. A 400 here is non-recoverable for spec-compliant
      // clients (they only re-init on 404). See issue #5169.
      //
      // Auto-recovery: if the client sends an initialize request with a stale session
      // id (e.g. after a server restart or idle eviction), treat it as a fresh
      // initialization rather than hard-failing with 404. This avoids requiring users
      // to manually restart their MCP client after every server restart.
      if (await isInitializeRequest(request)) {
        const newSession = createStreamableSession();
        try {
          const response = await withMcpHttpAuthContext(request, () =>
            handleRequestWithAuthInfo(newSession.transport, request)
          );
          return withSessionHeader(response, newSession.sessionId);
        } catch (err) {
          closeStreamableSession(newSession.sessionId);
          console.error("[MCP] Streamable HTTP error during stale-session recovery:", err);
          return new Response(JSON.stringify({ error: "MCP transport error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return errorResponse("Not Found: Unknown Mcp-Session-Id header", -32000, 404);
    }

    try {
      session.lastActivityAt = Date.now();
      const response = await withMcpHttpAuthContext(request, () =>
        handleRequestWithAuthInfo(session.transport, request)
      );
      if (request.method === "DELETE") {
        closeStreamableSession(sessionId);
      }
      return withSessionHeader(response, sessionId);
    } catch (err) {
      console.error("[MCP] Streamable HTTP error:", err);
      if (request.method === "DELETE") {
        closeStreamableSession(sessionId);
      }
      return new Response(JSON.stringify({ error: "MCP transport error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (!(await isInitializeRequest(request))) {
    return errorResponse("Bad Request: Mcp-Session-Id header is required", -32000);
  }

  const session = createStreamableSession();

  try {
    const response = await withMcpHttpAuthContext(request, () =>
      handleRequestWithAuthInfo(session.transport, request)
    );
    return withSessionHeader(response, session.sessionId);
  } catch (err) {
    closeStreamableSession(session.sessionId);
    console.error("[MCP] Streamable HTTP error:", err);
    return new Response(JSON.stringify({ error: "MCP transport error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle Streamable HTTP requests (POST / GET / DELETE).
 * Used by the Next.js route at /api/mcp/stream.
 */
export async function handleMcpStreamableHTTP(request: Request): Promise<Response> {
  return protectMcpSseResponse(request, await handleStreamableRequest(request));
}

interface RpcRequest {
  method?: string;
  [key: string]: unknown;
}

/**
 * Handle SSE requests.
 * SSE transport is implemented via Streamable HTTP transport with GET for SSE stream
 * and POST for messages (the Streamable HTTP transport supports both patterns).
 *
 * R-9: each client gets its own session. An `initialize` creates a session and touches
 * nothing else (a second client's initialize used to reset a shared singleton, dropping
 * the first client); an unknown session id answers 404 so spec-compliant clients
 * re-initialize; a header-less follow-up falls back to the most recent SSE session for
 * legacy clients that never echo mcp-session-id.
 */
export async function handleMcpSSE(request: Request): Promise<Response> {
  const headerSessionId = request.headers.get("mcp-session-id");
  let session: McpHttpSession | undefined;
  // A session created by THIS initialize must not outlive a failed initialize (final audit
  // A-5): the Streamable HTTP path already closes it in its catch; the SSE path did not, and
  // left it in the map until the 5-minute idle sweep.
  let createdHere = false;

  if (await isInitializeRequest(request)) {
    session = createSession("sse");
    createdHere = true;
  } else if (headerSessionId) {
    session = _sessions.get(headerSessionId);
    if (!session) {
      return errorResponse("Not Found: Unknown Mcp-Session-Id header", -32000, 404);
    }
  } else {
    session = _lastSseSessionId ? _sessions.get(_lastSseSessionId) : undefined;
    if (!session) {
      return errorResponse("Bad Request: send an initialize request first", -32000);
    }
  }

  const active = session;
  try {
    active.lastActivityAt = Date.now();
    const response = await withMcpHttpAuthContext(request, () =>
      handleRequestWithAuthInfo(active.transport, request)
    );
    if (request.method === "DELETE") {
      closeSession(active.sessionId);
    }
    return protectMcpSseResponse(request, withSessionHeader(response, active.sessionId));
  } catch (err) {
    if (createdHere) closeSession(active.sessionId);
    console.error("[MCP] SSE error:", err);
    return new Response(JSON.stringify({ error: "MCP SSE transport error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export function getMcpHttpStatus(): {
  online: boolean;
  transport: string | null;
  startedAt: number | null;
  uptime: string | null;
} {
  const sessions = Array.from(_sessions.values());
  const startedAt =
    sessions.length > 0 ? Math.min(...sessions.map((session) => session.startedAt)) : null;
  const transport = sessions.some((session) => session.kind === "streamable-http")
    ? "streamable-http"
    : sessions.length > 0
      ? "sse"
      : null;
  const online = transport !== null;

  return {
    online,
    transport,
    startedAt,
    uptime: startedAt ? `${Math.floor((Date.now() - startedAt) / 1000)}s` : null,
  };
}

export function isMcpHttpTransportReady(
  enabled: boolean,
  transport: string | null | undefined
): boolean {
  return enabled && (transport === "sse" || transport === "streamable-http");
}

export function shutdownMcpHttp(): void {
  closeAllSessions();
  console.log("[MCP] HTTP transport shutdown");
}

export function isMcpHttpActive(): boolean {
  return _sessions.size > 0;
}

/** Live HTTP sessions across both endpoints (bounded by the cap). */
export function getMcpHttpSessionCount(): number {
  return _sessions.size;
}

export { MCP_MAX_HTTP_SESSIONS };
