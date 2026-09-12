/**
 * #4227 — Cursor Cloud Agent (REST adapter).
 *
 * Validates the adapter mapping between Cursor's Background/Cloud Agents REST API and
 * OmniRoute's CloudAgentBase contract (status mapping, request shape, result extraction)
 * against a loopback stand-in. NOTE: this proves the adapter's internal mapping, NOT the live
 * Cursor API shapes — those need a live validation run with a real Cursor API key before
 * merge (Rule #18, external-API integration; see the PR description).
 *
 * SSRF S-6: adapters go through the pinned guarded client (undici dispatcher), which a
 * `globalThis.fetch` mock does not intercept — hence the real loopback server, reached
 * through the per-credential `baseUrl` override the adapter already supports.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const cursorMod = await import("../../src/lib/cloudAgent/agents/cursor.ts");
const registry = await import("../../src/lib/cloudAgent/registry.ts");

const SOURCE = { repoName: "org/repo", repoUrl: "https://github.com/org/repo", branch: "main" };
const OPTIONS = { autoCreatePr: true };

type Hit = { method: string; url: string; auth?: string; body: unknown };
let server: Server;
let base = "";
let hits: Hit[] = [];
let respond: (hit: Hit) => { status: number; json?: unknown; text?: string } = () => ({ status: 200, json: {} });

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const hit: Hit = {
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      };
      hits.push(hit);
      const r = respond(hit);
      if (r.text !== undefined) {
        res.writeHead(r.status, { "Content-Type": "text/plain" });
        return res.end(r.text);
      }
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const creds = () => ({ apiKey: "key_test_123", baseUrl: base });
const reset = (fn: typeof respond) => {
  hits = [];
  respond = fn;
};

test("#4227 registry exposes cursor-cloud as a cloud-agent provider", () => {
  assert.equal(registry.isCloudAgentProvider("cursor-cloud"), true);
  const agent = registry.getAgent("cursor-cloud");
  assert.ok(agent, "getAgent('cursor-cloud') returns an instance");
  assert.equal(agent?.providerId, "cursor-cloud");
  assert.ok(registry.getAvailableAgents().includes("cursor-cloud"));
});

test("#4227 createTask posts the prompt+repo and maps CREATING → queued", async () => {
  const agent = new cursorMod.CursorCloudAgent();
  reset(() => ({ status: 200, json: { id: "bc-abc123", status: "CREATING", name: "agent-1" } }));

  const task = await agent.createTask({ prompt: "fix the bug", source: SOURCE, options: OPTIONS }, creds());
  assert.equal(task.providerId, "cursor-cloud");
  assert.equal(task.externalId, "bc-abc123");
  assert.equal(task.status, "queued");
  assert.equal(task.prompt, "fix the bug");
  // request shape
  assert.equal(hits.length, 1, "one request was made");
  const [hit] = hits;
  assert.equal(hit.method, "POST");
  assert.match(hit.url, /\/agents$/);
  assert.equal(hit.auth, "Bearer key_test_123");
  const body = hit.body as { prompt: { text: string }; source: { repository: string; ref: string }; autoCreatePr: boolean };
  assert.equal(body.prompt.text, "fix the bug");
  assert.equal(body.source.repository, "https://github.com/org/repo");
  assert.equal(body.source.ref, "main");
  assert.equal(body.autoCreatePr, true);
});

test("#4227 createTask surfaces an upstream error instead of swallowing it", async () => {
  const agent = new cursorMod.CursorCloudAgent();
  reset(() => ({ status: 401, text: "nope" }));
  await assert.rejects(
    agent.createTask({ prompt: "x", source: SOURCE, options: {} }, creds()),
    /Cursor create agent failed: 401/
  );
});

test("#4227 getStatus maps FINISHED → completed and extracts the PR url + conversation", async () => {
  const agent = new cursorMod.CursorCloudAgent();
  reset(() => ({
    status: 200,
    json: {
      id: "bc-abc123",
      status: "FINISHED",
      target: { prUrl: "https://github.com/org/repo/pull/7", branchName: "cursor/fix" },
      summary: "Fixed it",
      conversation: [{ type: "assistant_message", text: "done", createdAt: "2026-06-19T00:00:00Z" }],
    },
  }));
  const result = await agent.getStatus("bc-abc123", creds());
  assert.equal(result.status, "completed");
  assert.equal(result.result?.prUrl, "https://github.com/org/repo/pull/7");
  assert.equal(result.result?.summary, "Fixed it");
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].content, "done");
  assert.match(hits[0].url, /\/agents\/bc-abc123$/);
});

test("#4227 getStatus maps Cursor enums (RUNNING→running, ERROR→failed)", async () => {
  const agent = new cursorMod.CursorCloudAgent();
  reset(() => ({ status: 200, json: { status: "RUNNING" } }));
  assert.equal((await agent.getStatus("id", creds())).status, "running");
  reset(() => ({ status: 200, json: { status: "ERROR", error: "boom" } }));
  const r = await agent.getStatus("id", creds());
  assert.equal(r.status, "failed");
  assert.equal(r.error, "boom");
});

test("#4227 sendMessage posts a followup; approvePlan is unsupported", async () => {
  const agent = new cursorMod.CursorCloudAgent();
  reset(() => ({ status: 200, json: { ok: true } }));
  const activity = await agent.sendMessage("bc-1", "also add tests", creds());
  assert.equal(activity.type, "message");
  assert.equal(activity.content, "also add tests");
  assert.match(hits[0].url, /\/agents\/bc-1\/followup$/);
  assert.equal((hits[0].body as { prompt: { text: string } }).prompt.text, "also add tests");
  await assert.rejects(agent.approvePlan("bc-1", creds()), /do not support plan approval/);
});

test("#4227 listSources normalizes the repositories list", async () => {
  const agent = new cursorMod.CursorCloudAgent();
  reset(() => ({
    status: 200,
    json: { repositories: [{ url: "https://github.com/org/repo", name: "org/repo" }] },
  }));
  const sources = await agent.listSources(creds());
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://github.com/org/repo");
  assert.equal(sources[0].name, "org/repo");
});
