/**
 * Regression for SSRF finding S-6 (Fase 1): cloud-agent adapters reach their REST API
 * through `CloudAgentBase.agentFetch` — the pinned guarded client. The Cursor adapter takes a
 * per-credential `baseUrl` (operator data stored in cloud_agent_credentials), so it is the
 * adapter used to prove the contract: cloud metadata is never reached, redirects are never
 * followed, and a guard decision surfaces as `OutboundUrlGuardError` (not a wire error).
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

import { CursorCloudAgent } from "@/lib/cloudAgent/agents/cursor";
import { OutboundUrlGuardError } from "@/shared/network/outboundUrlGuard";

const SOURCE = { repoName: "org/repo", repoUrl: "https://github.com/org/repo", branch: "main" };

let server: Server;
let base = "";
let hits = 0;

before(async () => {
  server = createServer((_req, res) => {
    hits += 1;
    res.writeHead(302, { Location: "http://127.0.0.1:9/internal" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("S-6 cursor: a cloud-metadata baseUrl is blocked before any socket", async () => {
  const agent = new CursorCloudAgent();
  await assert.rejects(
    agent.createTask(
      { prompt: "x", source: SOURCE, options: {} },
      { apiKey: "k", baseUrl: "http://169.254.169.254/v0" }
    ),
    (e: unknown) => e instanceof OutboundUrlGuardError
  );
  await assert.rejects(
    agent.getStatus("id", { apiKey: "k", baseUrl: "http://169.254.169.254/v0" }),
    (e: unknown) => e instanceof OutboundUrlGuardError
  );
});

test("S-6 cursor: a redirect from the agent API is never followed", async () => {
  const agent = new CursorCloudAgent();
  hits = 0;
  await assert.rejects(
    agent.listSources({ apiKey: "k", baseUrl: base }),
    (e: unknown) => e instanceof OutboundUrlGuardError && /redirect blocked/i.test(e.message)
  );
  assert.equal(hits, 1, "the redirect target must not be requested");
});

test("S-6 cursor: embedded credentials in the baseUrl are rejected", async () => {
  const agent = new CursorCloudAgent();
  await assert.rejects(
    agent.listSources({ apiKey: "k", baseUrl: "https://user:pw@api.cursor.com/v0" }),
    (e: unknown) => e instanceof OutboundUrlGuardError
  );
});
