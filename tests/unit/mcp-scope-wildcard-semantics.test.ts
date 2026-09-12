/**
 * M-2 — the `*` scope is the documented super-user grant for the MCP tool surface: it matches
 * every tool scope in the map, is only ever minted by a management principal (POST /api/keys is
 * MANAGEMENT-class — see tests/unit/authz/route-origin-auth-matrix.test.ts) and is audited as a
 * privileged grant (tests/unit/db/api-keys.test.ts). This file pins the matching semantics so a
 * family wildcard can never quietly widen into another family.
 */
import assert from "node:assert/strict";
import test from "node:test";

const { evaluateToolScopes } = await import("../../open-sse/mcp-server/scopeEnforcement.ts");
const { MCP_TOOL_MAP } = await import("../../open-sse/mcp-server/schemas/tools.ts");
const { PRIVILEGED_API_KEY_SCOPES, hasPrivilegedScope } =
  await import("../../src/shared/constants/managementScopes.ts");

const toolNames = Object.keys(MCP_TOOL_MAP);
const allRequired = new Set(
  toolNames.flatMap((name) => MCP_TOOL_MAP[name as keyof typeof MCP_TOOL_MAP]?.scopes ?? [])
);

test("the tool map is non-trivial and every tool declares at least one scope", () => {
  // Core map (45 at the time of writing); feature tool files declare inline scopes and are
  // covered by their own suites — the matching semantics below are what this file pins.
  assert.ok(toolNames.length >= 40, `unexpectedly small tool map: ${toolNames.length}`);
  for (const name of toolNames) {
    const scopes = MCP_TOOL_MAP[name as keyof typeof MCP_TOOL_MAP]?.scopes ?? [];
    assert.ok(scopes.length > 0, `${name} must declare scopes (fail-closed otherwise)`);
  }
});

test("`*` matches every declared tool scope (documented full access)", () => {
  for (const name of toolNames) {
    const check = evaluateToolScopes(name, ["*"], true);
    assert.equal(check.allowed, true, `${name} should be reachable with *`);
  }
});

test("a family wildcard never crosses families (read:* ≠ write:* ≠ execute:*)", () => {
  const families = new Map<string, string[]>();
  for (const scope of allRequired) {
    const family = scope.split(":")[0];
    families.set(family, [...(families.get(family) ?? []), scope]);
  }
  assert.ok(families.size >= 3, "expected read/write/execute families at least");
  for (const [family, scopes] of families) {
    const grant = [`${family}:*`];
    for (const name of toolNames) {
      const required = MCP_TOOL_MAP[name as keyof typeof MCP_TOOL_MAP]?.scopes ?? [];
      const expectAllowed = required.every((s) => s.startsWith(`${family}:`));
      const check = evaluateToolScopes(name, grant, true);
      assert.equal(
        check.allowed,
        expectAllowed,
        `${name} (${required.join(",")}) with ${grant[0]} → expected ${expectAllowed}`
      );
    }
    assert.ok(scopes.length > 0);
  }
});

test("no tool relies on an `admin:` scope today (so `*` ⊇ admin is not a hidden escalation)", () => {
  const adminScopes = [...allRequired].filter((s) => s.startsWith("admin"));
  assert.deepEqual(adminScopes, []);
});

test("`*` and `admin` are privileged API-key scopes exactly like `manage`", () => {
  assert.deepEqual([...PRIVILEGED_API_KEY_SCOPES].sort(), ["*", "admin", "manage"]);
  assert.equal(hasPrivilegedScope(["read:health"]), false);
  assert.equal(hasPrivilegedScope(["mcp:connect"]), false);
  for (const s of PRIVILEGED_API_KEY_SCOPES) assert.equal(hasPrivilegedScope(["x", s]), true);
});
