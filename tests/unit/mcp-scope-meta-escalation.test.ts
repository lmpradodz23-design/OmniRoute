/**
 * Regression for finding M-1 (Fase 1 §7): `resolveCallerScopeContext` accepted scopes from
 * `extra._meta` — the CLIENT's own request payload (the SDK copies `request.params._meta`
 * there) — whenever no `authInfo` scopes were present. Any caller without a per-key identity
 * (stdio, a management-session cookie over HTTP, an API key with `scopes: []`) could send
 * `_meta: { scopes: ["*"] }` and reach every write/execute/admin tool.
 *
 * Contract after the fix: scopes come ONLY from the resolved `authInfo` (per-key) or the
 * operator's `OMNIROUTE_MCP_SCOPES` env fallback; `_meta` — in every spelling the old code
 * honoured — is ignored, and `source` is never `"meta"`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateToolScopes,
  resolveCallerScopeContext,
} from "../../open-sse/mcp-server/scopeEnforcement.ts";

const WRITE_TOOL = "omniroute_switch_combo"; // requires write:combos

const META_SPELLINGS: Array<[string, unknown]> = [
  ["_meta.scopes", { scopes: ["*"] }],
  ["_meta.auth.scopes", { auth: { scopes: ["*"] } }],
  ["_meta.omniroute.scopes", { omniroute: { scopes: ["*"] } }],
];

for (const [label, meta] of META_SPELLINGS) {
  test(`(a) stdio caller: ${label} is ignored — no env fallback → no scopes, write tool denied`, () => {
    const ctx = resolveCallerScopeContext({ _meta: meta }, []);
    assert.equal(ctx.source, "none");
    assert.deepEqual(ctx.scopes, []);
    assert.notEqual(ctx.source as string, "meta");
    const check = evaluateToolScopes(WRITE_TOOL, ctx.scopes, true);
    assert.equal(check.allowed, false);
    assert.ok(check.missing.includes("write:combos"));
  });
}

test("(b) management-session cookie over HTTP (no authInfo): _meta ignored, only the operator env fallback applies", () => {
  const ctx = resolveCallerScopeContext(
    { sessionId: "cookie-session-1", _meta: { scopes: ["*"] } },
    ["read:health"]
  );
  assert.equal(ctx.callerId, "cookie-session-1");
  assert.equal(ctx.source, "env");
  assert.deepEqual(ctx.scopes, ["read:health"]);
  assert.equal(evaluateToolScopes(WRITE_TOOL, ctx.scopes, true).allowed, false);
  assert.equal(evaluateToolScopes("omniroute_get_health", ctx.scopes, true).allowed, true);
});

test("(c) API key with scopes: [] — _meta ignored; env fallback if configured, else nothing", () => {
  const withEnv = resolveCallerScopeContext(
    { authInfo: { clientId: "key-7", scopes: [] }, _meta: { scopes: ["admin:*"] } },
    ["read:health"]
  );
  assert.equal(withEnv.callerId, "key-7");
  assert.equal(withEnv.source, "env");
  assert.deepEqual(withEnv.scopes, ["read:health"]);

  const withoutEnv = resolveCallerScopeContext(
    { authInfo: { clientId: "key-7", scopes: [] }, _meta: { scopes: ["admin:*"] } },
    []
  );
  assert.equal(withoutEnv.source, "none");
  assert.deepEqual(withoutEnv.scopes, []);
  assert.equal(evaluateToolScopes(WRITE_TOOL, withoutEnv.scopes, true).allowed, false);
});

test("authInfo scopes still win, and _meta cannot widen them", () => {
  const ctx = resolveCallerScopeContext(
    { authInfo: { clientId: "key-1", scopes: ["read:combos"] }, _meta: { scopes: ["*"] } },
    ["*"]
  );
  assert.equal(ctx.source, "authInfo");
  assert.deepEqual(ctx.scopes, ["read:combos"]);
  assert.equal(evaluateToolScopes(WRITE_TOOL, ctx.scopes, true).allowed, false);
});
