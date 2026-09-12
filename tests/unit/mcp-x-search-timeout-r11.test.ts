// R-11 (audit/02-ARCHITECTURE.md): every MCP tool's internal fetch is bounded by the
// env-tunable budgets in fetchTimeout.ts (10 s management / 60 s upstream), except
// omniroute_x_search, which carried a hardcoded AbortSignal.timeout(120000). One tool
// ignoring OMNIROUTE_MCP_UPSTREAM_TIMEOUT_MS is exactly the inconsistency operators
// cannot diagnose from configuration.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const serverSource = fs.readFileSync(
  path.join(process.cwd(), "open-sse/mcp-server/server.ts"),
  "utf8"
);

test("no MCP tool fetch carries a hardcoded AbortSignal.timeout(...) budget", () => {
  assert.doesNotMatch(serverSource, /AbortSignal\.timeout\(\s*\d+/);
});

test("omniroute_x_search shares the upstream fetch budget with the other search tools", () => {
  const xSearch = serverSource.slice(serverSource.indexOf('search_type: "x"'));
  const signalLine = xSearch.slice(0, xSearch.indexOf("logToolCall"));
  assert.match(signalLine, /signal:\s*mcpFetchTimeoutSignal\("upstream"\)/);
});
