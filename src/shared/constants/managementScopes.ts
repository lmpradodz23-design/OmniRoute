/**
 * Management API key scopes — the set of API key scopes that authorize a
 * Bearer key on management routes (`/api/*` excluding `/api/v1/*` and the
 * public allowlist).
 *
 * Single source of truth shared by:
 *   - `src/lib/api/requireManagementAuth.ts` (`hasManageScope`)
 *   - `src/shared/utils/apiAuth.ts` (`validateBearerApiKeyForManagement`)
 *
 * Keep both helpers in sync by importing `MANAGEMENT_API_KEY_SCOPES` from
 * here — never re-declare the list inline.
 */

/** Canonical scope name granted to the default environment key. */
export const MANAGE_SCOPE = "manage";

/**
 * Set of scopes that grant access to management API routes.
 * `admin` is treated as a superset of `manage`.
 */
export const MANAGEMENT_API_KEY_SCOPES = new Set<string>(["manage", "admin"]);

/**
 * Scopes whose issuance is a privileged act and must always leave an audit trail
 * (`apiKey.create` with `privileged: true`, `apiKey.scopes.grant` / `.revoke`):
 *   - `manage` / `admin` — management API surface (`admin` ⊇ `manage`);
 *   - `*` — every MCP tool scope (`open-sse/mcp-server/scopeEnforcement.ts` treats a
 *     bare `*` as matching any required scope). This is deliberate: `*` is the
 *     operator's super-user grant, only mintable by a management principal
 *     (POST /api/keys is MANAGEMENT-class), never by a client's own request payload.
 */
export const PRIVILEGED_API_KEY_SCOPES = new Set<string>(["manage", "admin", "*"]);

/** Whether any of the given scopes is a privileged grant (see `PRIVILEGED_API_KEY_SCOPES`). */
export function hasPrivilegedScope(scopes: readonly string[] = []): boolean {
  return scopes.some((scope) => PRIVILEGED_API_KEY_SCOPES.has(scope));
}

/**
 * Narrow, additive scope (#7895) that grants a non-loopback caller ONLY the
 * `/api/mcp/` LOCAL_ONLY carve-out (see `LOCAL_ONLY_MANAGE_SCOPE_BYPASS_PREFIXES`
 * in `src/server/authz/routeGuard.ts`) — it does NOT grant broader management
 * API access. Deliberately kept OUT of `MANAGEMENT_API_KEY_SCOPES`, mirroring the
 * existing narrow-additive-scope precedent (`SELF_USAGE_SCOPE`,
 * `API_KEY_BYPASS_PROVIDER_QUOTA_SCOPE`). A key holding `manage`/`admin` still
 * passes the carve-out unchanged; `mcp:connect` is an alternative, lower-privilege
 * path for remote MCP-only callers.
 */
export const MCP_CONNECT_SCOPE = "mcp:connect";

/**
 * Check whether any of the given scopes authorizes the `/api/mcp/` LOCAL_ONLY
 * carve-out specifically — i.e. either a full management scope (`manage`/`admin`)
 * or the narrow `mcp:connect` scope. Use this ONLY for the `/api/mcp/` bypass
 * check; every other management route must keep using `hasManageScope`.
 */
export function hasMcpConnectOrManageScope(scopes: readonly string[] = []): boolean {
  if (hasManageScope(scopes)) return true;
  return scopes.includes(MCP_CONNECT_SCOPE);
}

/**
 * Check whether any of the given scopes authorizes management API access.
 */
export function hasManageScope(scopes: readonly string[] = []): boolean {
  for (const scope of scopes) {
    if (MANAGEMENT_API_KEY_SCOPES.has(scope)) return true;
  }
  return false;
}
