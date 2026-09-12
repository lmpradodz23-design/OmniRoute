/**
 * Community server federation — connect, sync, and manage servers.
 *
 * @module lib/gamification/servers
 */

import crypto from "crypto";
import {
  hardenedWebhookFetch,
  type WebhookLookupFn,
} from "@/shared/network/hardenedWebhookFetch";
import {
  OutboundUrlGuardError,
  isCloudMetadataHost,
  isPrivateHost,
  parseOutboundUrl,
} from "@/shared/network/outboundUrlGuard";
import { arePrivateProviderUrlsAllowed } from "@/shared/network/outboundUrlGuardPolicy";
import { normalizeHost } from "@/shared/network/privateHost";

export interface ServerConnection {
  id: string;
  name: string;
  url: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
  errorMessage: string | null;
}

/**
 * Per-call network overrides (SSRF finding S-3). `lookup` and `allowPrivate` make the outbound
 * properties unit-testable without real DNS or the global opt-in; production callers pass
 * nothing and get real resolution plus the operator's private-URL policy.
 */
export interface FederationOptions {
  lookup?: WebhookLookupFn;
  allowPrivate?: boolean;
  timeoutMs?: number;
}

/** Thrown by `connectServer` for a server URL that must never be persisted. */
export class FederationUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FederationUrlError";
  }
}

const LEADERBOARD_MAX_BODY_BYTES = 1024 * 1024;
const LEADERBOARD_MAX_ENTRIES = 10_000;
const LEADERBOARD_MAX_KEY_LENGTH = 256;

/**
 * Validate a federation server URL at write time: http/https only, no embedded credentials,
 * never a cloud-metadata host, private/LAN only under the operator's private-URL opt-in. The
 * use-time client re-validates the RESOLVED address and pins the connection, so DNS changing
 * after registration cannot redirect federation traffic into the network.
 */
export function assertFederationUrl(raw: string, options: { allowPrivate: boolean }): URL {
  let url: URL;
  try {
    url = parseOutboundUrl(raw);
  } catch (error) {
    throw new FederationUrlError(
      `Federation server URL rejected: invalid URL (${error instanceof Error ? error.message : "unparseable"})`
    );
  }
  const host = normalizeHost(url.hostname);
  if (isCloudMetadataHost(host)) {
    throw new FederationUrlError("Federation server URL rejected: cloud-metadata target");
  }
  if (isPrivateHost(host) && !options.allowPrivate) {
    throw new FederationUrlError(
      "Federation server URL rejected: private/reserved target (enable the private-URL opt-in to federate with LAN servers)"
    );
  }
  return url;
}

/**
 * URL-free description of a guard decision. The guard's message embeds the full target URL,
 * which must never land in `community_servers.error_message` or be returned to the dashboard.
 */
function describeFederationBlock(error: OutboundUrlGuardError): string {
  if (/redirect/i.test(error.message)) return "Blocked: redirect not followed (outbound guard)";
  if (/metadata/i.test(error.message)) return "Blocked: cloud metadata target";
  if (/No DNS records/i.test(error.message)) return "Blocked: hostname did not resolve";
  if (error.code === "OUTBOUND_URL_INVALID") return "Blocked: invalid outbound URL";
  return "Blocked: private/reserved outbound target";
}

function describeFederationError(error: unknown): string {
  if (error instanceof OutboundUrlGuardError) return describeFederationBlock(error);
  return error instanceof Error && error.message ? error.message : "Federation request failed";
}

/**
 * Hardened federation request: every resolved address validated, connection pinned, redirects
 * never followed, bounded body and timeout. The body is the peer's payload, so it is read even
 * for a LAN server admitted through the opt-in (metadata stays blocked regardless).
 */
async function federationFetch(
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number },
  options: FederationOptions
) {
  return hardenedWebhookFetch(url, {
    method: init.method,
    headers: { "User-Agent": "OmniRoute/federation", ...(init.headers ?? {}) },
    body: init.body,
    timeoutMs: options.timeoutMs ?? init.timeoutMs,
    allowPrivate: options.allowPrivate ?? arePrivateProviderUrlsAllowed(),
    lookup: options.lookup,
    maxBodyBytes: LEADERBOARD_MAX_BODY_BYTES,
    withholdPrivateBody: false,
  });
}

/** Keep only `{ apiKeyId: non-empty string, score: finite number }`; null when the shape is wrong. */
function parseLeaderboardEntries(raw: unknown): Array<{ apiKeyId: string; score: number }> | null {
  if (!raw || typeof raw !== "object") return null;
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  const valid: Array<{ apiKeyId: string; score: number }> = [];
  for (const entry of entries.slice(0, LEADERBOARD_MAX_ENTRIES)) {
    if (!entry || typeof entry !== "object") continue;
    const { apiKeyId, score } = entry as Record<string, unknown>;
    if (typeof apiKeyId !== "string" || apiKeyId.length === 0) continue;
    if (apiKeyId.length > LEADERBOARD_MAX_KEY_LENGTH) continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    valid.push({ apiKeyId, score });
  }
  return valid;
}

/**
 * Connect to a community server. The URL is validated before anything is persisted.
 */
export async function connectServer(
  name: string,
  url: string,
  apiKey: string,
  options: FederationOptions = {}
): Promise<ServerConnection> {
  assertFederationUrl(url, {
    allowPrivate: options.allowPrivate ?? arePrivateProviderUrlsAllowed(),
  });

  const id = crypto.randomUUID();
  const apiKeyHash = crypto
    .pbkdf2Sync(apiKey, "omniroute-federation-salt", 120000, 32, "sha256")
    .toString("hex");

  const { connectServer: dbConnect } = await import("../db/gamification");
  dbConnect(id, name, url, apiKeyHash);

  return { id, name, url, status: "connected", lastSyncAt: null, errorMessage: null };
}

/**
 * Disconnect from a community server.
 */
export async function disconnectServer(serverId: string): Promise<void> {
  const { disconnectServer: dbDisconnect } = await import("../db/gamification");
  dbDisconnect(serverId);
}

/**
 * List all connected servers.
 */
export async function listServers(): Promise<ServerConnection[]> {
  const { listServers: dbList } = await import("../db/gamification");
  return dbList() as ServerConnection[];
}

/**
 * Sync leaderboard with a community server.
 * Fetches remote scores and merges into local leaderboard.
 */
export async function syncLeaderboard(
  serverId: string,
  options: FederationOptions = {}
): Promise<{ synced: number; errors: string[] }> {
  const db = (await import("../db/core")).getDbInstance();

  const server = db
    .prepare(
      "SELECT url, api_key_hash FROM community_servers WHERE id = ? AND status = 'connected'"
    )
    .get(serverId) as { url: string; api_key_hash: string } | undefined;

  if (!server) {
    return { synced: 0, errors: ["Server not found or not connected"] };
  }

  try {
    // Fetch the remote leaderboard through the hardened client (S-3): resolved-address
    // validation, pinned connection, redirects never followed.
    const response = await federationFetch(
      `${server.url}/api/gamification/federation/leaderboard`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${server.api_key_hash}` },
        timeoutMs: 10_000,
      },
      options
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // The peer's payload is untrusted input: only well-formed entries reach the local table.
    const entries = parseLeaderboardEntries(JSON.parse(response.bodyText));
    if (!entries) {
      throw new Error("Invalid leaderboard payload from federation server");
    }

    // Overwrite local scores with remote scores (not additive)
    const db2 = (await import("../db/core")).getDbInstance();
    for (const entry of entries) {
      db2
        .prepare(
          `INSERT INTO leaderboard (api_key_id, scope, score, updated_at)
         VALUES (?, 'global', ?, datetime('now'))
         ON CONFLICT(api_key_id, scope) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`
        )
        .run(entry.apiKeyId, entry.score);
    }

    // Update last sync time
    db.prepare(
      "UPDATE community_servers SET last_sync_at = datetime('now'), error_message = NULL WHERE id = ?"
    ).run(serverId);

    return { synced: entries.length, errors: [] };
  } catch (err: unknown) {
    // A guard decision is terminal and is stored URL-free (the guard's own message carries
    // the target URL). Genuine upstream/parse failures keep their message.
    const message = describeFederationError(err);
    db.prepare("UPDATE community_servers SET status = 'error', error_message = ? WHERE id = ?").run(
      message,
      serverId
    );

    return { synced: 0, errors: [message] };
  }
}

/**
 * Push local scores to a community server.
 */
export async function pushScore(
  serverId: string,
  apiKeyId: string,
  score: number,
  options: FederationOptions = {}
): Promise<{ success: boolean; error?: string }> {
  const db = (await import("../db/core")).getDbInstance();

  const server = db
    .prepare(
      "SELECT url, api_key_hash FROM community_servers WHERE id = ? AND status = 'connected'"
    )
    .get(serverId) as { url: string; api_key_hash: string } | undefined;

  if (!server) {
    return { success: false, error: "Server not found or not connected" };
  }

  try {
    const response = await federationFetch(
      `${server.url}/api/gamification/federation/score`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${server.api_key_hash}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKeyId, score }),
        timeoutMs: 10_000,
      },
      options
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: describeFederationError(err) };
  }
}

/**
 * Health check a server connection.
 */
export async function healthCheck(
  serverId: string,
  options: FederationOptions = {}
): Promise<{ healthy: boolean; latencyMs: number }> {
  const db = (await import("../db/core")).getDbInstance();

  const server = db.prepare("SELECT url FROM community_servers WHERE id = ?").get(serverId) as
    | { url: string }
    | undefined;

  if (!server) return { healthy: false, latencyMs: 0 };

  const start = Date.now();
  try {
    const response = await federationFetch(
      `${server.url}/api/gamification/federation/leaderboard`,
      { method: "GET", timeoutMs: 5_000 },
      options
    );
    return { healthy: response.ok, latencyMs: Date.now() - start };
  } catch {
    // Blocked, redirected, unreachable or timed out: all unhealthy, none surfaced.
    return { healthy: false, latencyMs: Date.now() - start };
  }
}
