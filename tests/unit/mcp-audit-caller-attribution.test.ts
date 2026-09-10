/**
 * Regression for finding R-10 (Fase 1 §7): `mcp_tool_audit.api_key_id` was the static
 * `OMNIROUTE_API_KEY_ID` env var for every row, so over HTTP the audit trail could not tell
 * which API key made a call. `withScopeEnforcement` now runs each tool call inside
 * `runWithMcpCaller(resolvedCaller)`, and `logToolCall` records the resolved per-key
 * principal; the env id is only the stdio fallback, and a session id / "anonymous" is never
 * written into the column.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  getCurrentMcpCaller,
  resolveAuditApiKeyId,
  runWithMcpCaller,
} from "../../open-sse/mcp-server/callerContext.ts";

test("R-10: api_key_id is the resolved per-key caller inside the call", async () => {
  assert.equal(getCurrentMcpCaller(), undefined);

  await runWithMcpCaller({ callerId: "key-42", source: "authInfo" }, async () => {
    assert.deepEqual(getCurrentMcpCaller(), { callerId: "key-42", source: "authInfo" });
    assert.equal(resolveAuditApiKeyId(undefined, "env-key"), "key-42");
  });

  assert.equal(getCurrentMcpCaller(), undefined, "context does not leak out of the call");
});

test("R-10: a session id or anonymous caller is never written as an api key id — env fallback, else null", async () => {
  await runWithMcpCaller({ callerId: "cookie-session-1", source: "env" }, async () => {
    assert.equal(resolveAuditApiKeyId(undefined, "env-key"), "env-key");
    assert.equal(resolveAuditApiKeyId(undefined, undefined), null);
  });
  await runWithMcpCaller({ callerId: "anonymous", source: "none" }, async () => {
    assert.equal(resolveAuditApiKeyId(undefined, ""), null);
  });
});

test("R-10: outside any call (stdio bootstrap), the env id is the only attribution", () => {
  assert.equal(resolveAuditApiKeyId(undefined, "env-key"), "env-key");
  assert.equal(resolveAuditApiKeyId(undefined, undefined), null);
});

test("R-10: nested calls keep their own identity (AsyncLocalStorage isolation)", async () => {
  await runWithMcpCaller({ callerId: "key-outer", source: "authInfo" }, async () => {
    await runWithMcpCaller({ callerId: "key-inner", source: "authInfo" }, async () => {
      assert.equal(resolveAuditApiKeyId(), "key-inner");
    });
    assert.equal(resolveAuditApiKeyId(), "key-outer");
  });
});
