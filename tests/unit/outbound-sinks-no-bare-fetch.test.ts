/**
 * Structural lock for SSRF findings S-1 … S-6 (Fase 1).
 *
 * Every module that sends a request to an operator-configured or attacker-influenceable
 * URL must go through one of the hardened clients (`hardenedWebhookFetch`, `guardedFetch`,
 * or a wrapper over them such as `CloudAgentBase.agentFetch`) — never a bare `fetch(`. The
 * hardened clients are the only place a raw undici fetch is allowed to appear.
 *
 * A bare `fetch(` re-introduced into one of these files (a refactor, a merge, a new call
 * site) fails this test before any behavioural suite would notice.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(process.cwd());

/** Files whose outbound target is operator data or peer-controlled. */
const GUARDED_SINKS = [
  "src/lib/webhookDispatcher.ts",
  "src/lib/gamification/servers.ts",
  "src/lib/auth/oidcDiscovery.ts",
  "src/lib/obsidian/api.ts",
  "src/lib/memory/qdrant.ts",
  "src/lib/memory/genericBackend.ts",
  "src/lib/versionManager/healthMonitor.ts",
  "src/lib/cloudAgent/baseAgent.ts",
  "src/lib/cloudAgent/agents/cursor.ts",
  "src/lib/cloudAgent/agents/codex.ts",
  "src/lib/cloudAgent/agents/devin.ts",
  "src/lib/cloudAgent/agents/jules.ts",
  "src/lib/telegram/botApi.ts",
  "src/lib/notion/api.ts",
  "src/lib/agentSkills/catalog.ts",
  "src/app/api/v1/rerank/route.ts",
  "src/app/api/translator/send/route.ts",
];

/** The hardened clients themselves: raw undici only, never the global fetch. */
const HARDENED_CLIENTS = [
  "src/shared/network/hardenedWebhookFetch.ts",
  "src/shared/network/guardedFetch.ts",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** A `fetch(` call not qualified by an identifier/property (guardedFetch(, this.agentFetch(, undiciFetch(). */
const BARE_FETCH_CALL = /(^|[^\w.$])fetch\s*\(/;

test("guarded outbound sinks never call a bare fetch(", () => {
  const offenders: string[] = [];
  for (const rel of GUARDED_SINKS) {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `sink listed but missing: ${rel}`);
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const lines = code.split("\n");
    lines.forEach((line, i) => {
      if (BARE_FETCH_CALL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `bare fetch( in guarded sinks:\n${offenders.join("\n")}`);
});

test("hardened clients use the undici fetch, never the global one", () => {
  for (const rel of HARDENED_CLIENTS) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    assert.match(code, /fetch as undiciFetch/, `${rel} must import undici's fetch`);
    assert.doesNotMatch(code, BARE_FETCH_CALL, `${rel} must not call the global fetch`);
  }
});

test("every guarded sink imports a hardened client (or the base that wraps it)", () => {
  for (const rel of GUARDED_SINKS) {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const usesClient =
      /from "@\/shared\/network\/(guardedFetch|hardenedWebhookFetch)"/.test(code) ||
      /agentFetch\(/.test(code); // cloud-agent adapters go through CloudAgentBase.agentFetch
    assert.ok(usesClient, `${rel} does not use a hardened client`);
  }
});
