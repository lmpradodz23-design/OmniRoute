/**
 * Ambient identity of the MCP caller for the duration of one tool call (R-10).
 *
 * `withScopeEnforcement` (server.ts) resolves the caller once per call and runs the tool
 * handler inside `runWithMcpCaller`, so anything the handler does — in particular the audit
 * row written by `logToolCall` — can attribute the call to the RESOLVED caller instead of
 * the static `OMNIROUTE_API_KEY_ID` env var (which only describes the stdio operator).
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { CallerScopeContext } from "./scopeEnforcement.ts";

export type McpCallerIdentity = Pick<CallerScopeContext, "callerId" | "source">;

const callerStorage = new AsyncLocalStorage<McpCallerIdentity>();

export function runWithMcpCaller<T>(caller: McpCallerIdentity, fn: () => Promise<T>): Promise<T> {
  return callerStorage.run(caller, fn);
}

export function getCurrentMcpCaller(): McpCallerIdentity | undefined {
  return callerStorage.getStore();
}

/**
 * The `api_key_id` to record for the current call: the resolved per-key principal when the
 * caller authenticated with an API key (`source === "authInfo"`), else the stdio operator's
 * `OMNIROUTE_API_KEY_ID`, else null. A session id or "anonymous" is never written into the
 * api_key_id column — it is not a key.
 */
export function resolveAuditApiKeyId(
  caller: McpCallerIdentity | undefined = getCurrentMcpCaller(),
  envKeyId: string | undefined = process.env.OMNIROUTE_API_KEY_ID
): string | null {
  if (caller && caller.source === "authInfo" && caller.callerId.trim()) return caller.callerId;
  return envKeyId && envKeyId.trim() ? envKeyId : null;
}
