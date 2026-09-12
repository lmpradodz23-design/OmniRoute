// R-9 (audit/02-ARCHITECTURE.md): the "sse" MCP endpoint served every client from ONE
// shared server/transport, and any client's `initialize` reset it — dropping the other
// clients' sessions. Worse, creating the shared SSE server closed every Streamable HTTP
// session and creating a Streamable HTTP session closed the SSE transport, so two
// different MCP clients (say Claude Code on /api/mcp/stream and Codex on /api/mcp/sse)
// kept knocking each other offline. Sessions are now independent on both endpoints.
import test from "node:test";
import assert from "node:assert/strict";

process.env.OMNIROUTE_MCP_ENFORCE_SCOPES = "false";
const mod = await import("../../open-sse/mcp-server/httpTransport.ts");

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function initializeRequest(path: string, id: number, client: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      id,
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: client, version: "1.0.0" },
      },
    }),
  });
}

function toolsListRequest(path: string, id: number, sessionId: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { ...HEADERS, "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id, params: {} }),
  });
}

async function sessionIdOf(response: Response): Promise<string> {
  const sessionId = response.headers.get("mcp-session-id");
  assert.ok(sessionId, `initialize must answer with an mcp-session-id (status ${response.status})`);
  // Drain the body so the transport does not keep the stream open.
  await response.text().catch(() => "");
  return sessionId;
}

test("a second SSE client's initialize does not drop the first SSE client's session", async () => {
  mod.shutdownMcpHttp();
  const a = await sessionIdOf(await mod.handleMcpSSE(initializeRequest("/api/mcp/sse", 1, "A")));
  const b = await sessionIdOf(await mod.handleMcpSSE(initializeRequest("/api/mcp/sse", 1, "B")));
  assert.notEqual(a, b, "each client gets its own session");

  const aFollowUp = await mod.handleMcpSSE(toolsListRequest("/api/mcp/sse", 2, a));
  assert.equal(
    aFollowUp.status,
    200,
    `client A must keep working after B initialized (got ${aFollowUp.status})`
  );
  await aFollowUp.text().catch(() => "");
  mod.shutdownMcpHttp();
});

test("SSE and Streamable HTTP clients coexist: neither endpoint's initialize kills the other's session", async () => {
  mod.shutdownMcpHttp();
  const sse = await sessionIdOf(
    await mod.handleMcpSSE(initializeRequest("/api/mcp/sse", 1, "sse-client"))
  );
  const stream = await sessionIdOf(
    await mod.handleMcpStreamableHTTP(initializeRequest("/api/mcp/stream", 1, "stream-client"))
  );

  const sseAfterStream = await mod.handleMcpSSE(toolsListRequest("/api/mcp/sse", 2, sse));
  assert.equal(sseAfterStream.status, 200, "SSE session survives a Streamable HTTP initialize");
  await sseAfterStream.text().catch(() => "");

  await sessionIdOf(await mod.handleMcpSSE(initializeRequest("/api/mcp/sse", 1, "sse-client-2")));
  const streamAfterSse = await mod.handleMcpStreamableHTTP(
    toolsListRequest("/api/mcp/stream", 2, stream)
  );
  assert.equal(streamAfterSse.status, 200, "Streamable HTTP session survives an SSE initialize");
  await streamAfterSse.text().catch(() => "");

  const status = mod.getMcpHttpStatus();
  assert.equal(status.online, true);
  mod.shutdownMcpHttp();
  assert.equal(mod.isMcpHttpActive(), false);
});

test("the live-session cap evicts the least recently active session (bounded map)", async () => {
  // R-9 claimed "cap 64 with eviction" as covered; final audit A-5 found no case for it.
  mod.shutdownMcpHttp();
  const cap = mod.MCP_MAX_HTTP_SESSIONS;
  const first = await sessionIdOf(
    await mod.handleMcpSSE(initializeRequest("/api/mcp/sse", 1, "oldest"))
  );
  for (let i = 0; i < cap; i += 1) {
    // Each later session is more recently active than `first`, so `first` is the victim.
    await sessionIdOf(
      await mod.handleMcpStreamableHTTP(initializeRequest("/api/mcp/stream", 1, `c${i}`))
    );
  }
  assert.equal(mod.getMcpHttpSessionCount(), cap, "the map never exceeds the cap");
  const evicted = await mod.handleMcpSSE(toolsListRequest("/api/mcp/sse", 2, first));
  assert.equal(evicted.status, 404, "the evicted session answers 404 so the client re-initializes");
  await evicted.text().catch(() => "");
  mod.shutdownMcpHttp();
  assert.equal(mod.getMcpHttpSessionCount(), 0);
});

test("an unknown SSE session id answers 404 so a spec-compliant client re-initializes", async () => {
  mod.shutdownMcpHttp();
  await sessionIdOf(await mod.handleMcpSSE(initializeRequest("/api/mcp/sse", 1, "A")));
  const stale = await mod.handleMcpSSE(toolsListRequest("/api/mcp/sse", 2, "no-such-session"));
  assert.equal(stale.status, 404);
  mod.shutdownMcpHttp();
});
