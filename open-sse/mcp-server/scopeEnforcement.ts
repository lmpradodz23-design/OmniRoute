import { MCP_TOOL_MAP } from "./schemas/tools.ts";

type AuthInfoLike = {
  clientId?: string;
  scopes?: string[];
};

export type McpToolExtraLike = {
  authInfo?: AuthInfoLike;
  sessionId?: string;
  /**
   * The SDK copies the CLIENT's `request.params._meta` here. It is untrusted request payload
   * and is never a scope source (M-1): a caller with no per-key identity — stdio, a
   * management-session cookie, a key with `scopes: []` — could otherwise send
   * `_meta: { scopes: ["*"] }` and reach every write/execute/admin tool.
   */
  _meta?: unknown;
};

/** Where the caller's scopes came from: the resolved per-key identity, the operator's env fallback, or nowhere. */
export type ScopeSource = "authInfo" | "env" | "none";

export interface CallerScopeContext {
  callerId: string;
  scopes: string[];
  source: ScopeSource;
}

export interface ScopeCheckResult {
  allowed: boolean;
  required: string[];
  provided: string[];
  missing: string[];
  reason?: string;
}

// #4: MCP scope enforcement is ON by default (fail-closed). A `mcp:connect` transport key must
// never reach write:* / execute:* / admin:* tools just because a env var is unset. Only an
// EXPLICIT disable value opts out (legacy migration escape hatch).
const MCP_ENFORCE_OPT_OUT = new Set(["false", "0", "no", "off"]);

/**
 * Whether MCP per-tool scope enforcement is active. Default ON; disabled only when
 * `OMNIROUTE_MCP_ENFORCE_SCOPES` is explicitly one of false/0/no/off.
 */
export function isMcpScopeEnforcementEnabled(
  raw: string | undefined = process.env.OMNIROUTE_MCP_ENFORCE_SCOPES
): boolean {
  return !MCP_ENFORCE_OPT_OUT.has(
    String(raw ?? "")
      .trim()
      .toLowerCase()
  );
}

function normalizeScopeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function scopeMatches(grantedScope: string, requiredScope: string): boolean {
  if (grantedScope === "*" || grantedScope === requiredScope) {
    return true;
  }
  if (grantedScope.endsWith("*")) {
    const prefix = grantedScope.slice(0, -1);
    return requiredScope.startsWith(prefix);
  }
  return false;
}

export function resolveCallerScopeContext(
  extra: McpToolExtraLike | undefined,
  fallbackScopes: readonly string[] = []
): CallerScopeContext {
  const callerId =
    (typeof extra?.authInfo?.clientId === "string" && extra.authInfo.clientId.trim()) ||
    (typeof extra?.sessionId === "string" && extra.sessionId.trim()) ||
    "anonymous";

  // Only two sources exist: the per-key scopes resolved server-side (`authInfo`, fed by
  // httpAuthContext over HTTP) and the operator's OMNIROUTE_MCP_SCOPES env fallback. Anything
  // the client puts in its own request (`extra._meta`) is ignored.
  const authScopes = normalizeScopeList(extra?.authInfo?.scopes);
  if (authScopes.length > 0) {
    return { callerId, scopes: authScopes, source: "authInfo" };
  }

  const fallback = normalizeScopeList(fallbackScopes);
  if (fallback.length > 0) {
    return { callerId, scopes: fallback, source: "env" };
  }

  return { callerId, scopes: [], source: "none" };
}

export function evaluateToolScopes(
  toolName: string,
  callerScopes: readonly string[],
  enforceScopes: boolean,
  inlineScopes?: readonly string[]
): ScopeCheckResult {
  const provided = normalizeScopeList(callerScopes);

  if (!enforceScopes) {
    return { allowed: true, required: [], provided, missing: [] };
  }

  const toolScopes = inlineScopes ?? MCP_TOOL_MAP[toolName]?.scopes;
  const required = Array.isArray(toolScopes) ? Array.from(toolScopes) : [];

  if (required.length === 0) {
    return {
      allowed: false,
      required: [],
      provided,
      missing: [],
      reason: "tool_definition_missing",
    };
  }

  const missing = required.filter(
    (requiredScope) => !provided.some((grantedScope) => scopeMatches(grantedScope, requiredScope))
  );

  return {
    allowed: missing.length === 0,
    required,
    provided,
    missing,
    reason: missing.length > 0 ? "missing_scopes" : undefined,
  };
}
