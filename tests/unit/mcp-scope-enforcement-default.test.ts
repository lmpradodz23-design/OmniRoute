/**
 * Regression tests for finding #4 — MCP scope enforcement must be default-ON (fail-closed).
 *
 * A `mcp:connect` transport key must NOT be able to invoke write:* tools just because
 * `OMNIROUTE_MCP_ENFORCE_SCOPES` is unset.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateToolScopes,
  isMcpScopeEnforcementEnabled,
} from "@omniroute/open-sse/mcp-server/scopeEnforcement.ts";

test("mcp scopes: enforcement is ON by default (unset / empty / true)", () => {
  assert.equal(isMcpScopeEnforcementEnabled(undefined), true);
  assert.equal(isMcpScopeEnforcementEnabled(""), true);
  assert.equal(isMcpScopeEnforcementEnabled("true"), true);
  assert.equal(isMcpScopeEnforcementEnabled("1"), true);
  assert.equal(isMcpScopeEnforcementEnabled("anything-else"), true);
});

test("mcp scopes: only an explicit false/0/no/off opts out", () => {
  for (const v of ["false", "FALSE", " false ", "0", "no", "off", "OFF"]) {
    assert.equal(isMcpScopeEnforcementEnabled(v), false, `"${v}" must opt out`);
  }
});

test("mcp scopes: a mcp:connect-only caller is DENIED a write tool (fail-closed)", () => {
  const r = evaluateToolScopes("some_write_tool", ["mcp:connect"], true, ["write:combos"]);
  assert.equal(r.allowed, false);
  assert.deepEqual(r.missing, ["write:combos"]);
  assert.equal(r.reason, "missing_scopes");
});

test("mcp scopes: a tool with no scope definition is DENIED when enforcing", () => {
  const r = evaluateToolScopes("undeclared_tool", ["write:combos"], true, []);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "tool_definition_missing");
});

test("mcp scopes: a caller WITH the required scope is allowed", () => {
  const r = evaluateToolScopes("some_write_tool", ["write:combos"], true, ["write:combos"]);
  assert.equal(r.allowed, true);
});

test("mcp scopes: wildcard scope satisfies a required write scope", () => {
  const r = evaluateToolScopes("some_write_tool", ["write:*"], true, ["write:combos"]);
  assert.equal(r.allowed, true);
});
