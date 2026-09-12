/**
 * OIDC endpoint discovery and token exchange for the dashboard admin gate (SSRF finding S-4).
 *
 * The login and callback routes used to `fetch` the issuer's discovery document with plain
 * `fetch` (redirects followed, no DNS validation) and then accepted `authorization_endpoint`,
 * `token_endpoint` and `jwks_uri` VERBATIM from that document. A substituted or tampered document
 * could therefore direct the browser (authorization code + state) and the server's
 * `client_secret` (token exchange) to any host the document named.
 *
 * This module is the single place the routes obtain OIDC endpoints and post the token request:
 *
 *  1. The issuer and every endpoint must be `https:` (plain `http:` only to a loopback host, for a
 *     local development IdP), carry no embedded credentials, never be a cloud-metadata host, and
 *     be private/LAN only under the operator's private-URL opt-in.
 *  2. The discovery document is trusted ONLY if its `issuer` equals the configured issuer (an
 *     OIDC Discovery MUST — a missing or different value is exactly the mix-up / substitution
 *     signal). Otherwise the conventional endpoints under the configured issuer are used, which is
 *     what the routes already fell back to on any discovery failure.
 *  3. Network I/O goes through the hardened outbound client: every resolved address validated,
 *     connection pinned to the validated ip (no DNS rebinding between check and connect), redirects
 *     never followed, bounded body, bounded timeout.
 *
 * The JWKS itself is still fetched by `jose`'s `createRemoteJWKSet` in the callback route; only
 * the `jwks_uri` string is validated here (see the callback route for the residual note).
 *
 * `oidcDiscoveryInternals.transport` is a static test seam (the pattern `oidcCallbackInternals`
 * already uses): production keeps the pinned client; tests may swap in an adapter so the existing
 * URL-routed `globalThis.fetch` mocks keep working without touching real DNS.
 */
import { hardenedWebhookFetch } from "@/shared/network/hardenedWebhookFetch";
import {
  isCloudMetadataHost,
  isPrivateHost,
  parseOutboundUrl,
} from "@/shared/network/outboundUrlGuard";
import { arePrivateProviderUrlsAllowed } from "@/shared/network/outboundUrlGuardPolicy";
import { normalizeHost } from "@/shared/network/privateHost";

export interface OidcTransportResult {
  status: number;
  ok: boolean;
  bodyText: string;
}

export interface OidcTransportOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  allowPrivate: boolean;
  maxBodyBytes: number;
}

export type OidcTransport = (
  url: URL,
  options: OidcTransportOptions
) => Promise<OidcTransportResult>;

const DISCOVERY_TIMEOUT_MS = 5_000;
const TOKEN_TIMEOUT_MS = 10_000;
const DISCOVERY_MAX_BODY_BYTES = 64 * 1024;
const TOKEN_MAX_BODY_BYTES = 256 * 1024;

const hardenedTransport: OidcTransport = async (url, options) => {
  const result = await hardenedWebhookFetch(url, {
    method: options.method,
    headers: { "User-Agent": "OmniRoute/oidc", ...options.headers },
    body: options.body,
    timeoutMs: options.timeoutMs,
    allowPrivate: options.allowPrivate,
    maxBodyBytes: options.maxBodyBytes,
    // The response IS the payload (discovery document / token set) of an operator-configured
    // peer admitted through `allowPrivate`; metadata stays blocked by the client regardless.
    withholdPrivateBody: false,
  });
  return { status: result.status, ok: result.ok, bodyText: result.bodyText };
};

/** Static test seam — production always uses the pinned transport. */
export const oidcDiscoveryInternals: { transport: OidcTransport } = {
  transport: hardenedTransport,
};

export type OidcEndpointRejection =
  "invalid_url" | "metadata" | "https_required" | "private_without_optin";

export class OidcEndpointError extends Error {
  readonly reason: OidcEndpointRejection;

  constructor(message: string, reason: OidcEndpointRejection) {
    super(message);
    this.name = "OidcEndpointError";
    this.reason = reason;
  }
}

export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** Where the endpoints came from: a verified discovery document, or the issuer convention. */
  source: "discovery" | "conventional";
}

export interface OidcNetworkOptions {
  /** Defaults to the operator's private-URL opt-in policy. */
  allowPrivate?: boolean;
  timeoutMs?: number;
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return (
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")
  );
}

/** Trim whitespace and trailing slashes so `https://idp.example/` and `https://idp.example` agree. */
export function normalizeIssuer(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Validate a URL the IdP flow is about to send an authorization code, a `client_secret`, or trust
 * signing keys from. Throws `OidcEndpointError` with a machine-readable reason.
 */
export function assertOidcEndpointUrl(raw: string, options: { allowPrivate: boolean }): URL {
  let url: URL;
  try {
    // Scheme (http/https only) and embedded-credential checks.
    url = parseOutboundUrl(raw);
  } catch (error) {
    throw new OidcEndpointError(
      `OIDC endpoint rejected: ${error instanceof Error ? error.message : "invalid URL"}`,
      "invalid_url"
    );
  }

  const host = normalizeHost(url.hostname);
  if (isCloudMetadataHost(host)) {
    throw new OidcEndpointError("OIDC endpoint rejected: cloud-metadata host", "metadata");
  }

  const loopback = isLoopbackHost(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new OidcEndpointError(
      "OIDC endpoint rejected: https is required outside loopback",
      "https_required"
    );
  }

  if (isPrivateHost(host) && !options.allowPrivate) {
    throw new OidcEndpointError(
      "OIDC endpoint rejected: private host without the private-URL opt-in",
      "private_without_optin"
    );
  }

  return url;
}

function conventionalEndpoints(issuer: string): OidcEndpoints {
  return {
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
    source: "conventional",
  };
}

/**
 * Resolve the IdP endpoints for `issuer`. Never throws for a discovery failure — that falls back
 * to the conventional endpoints under the configured issuer, exactly as before. It DOES throw
 * (`OidcEndpointError`) when the configured issuer itself is not an acceptable target.
 */
export async function discoverOidcEndpoints(
  issuerRaw: string,
  options: OidcNetworkOptions = {}
): Promise<OidcEndpoints> {
  const issuer = normalizeIssuer(issuerRaw);
  const allowPrivate = options.allowPrivate ?? arePrivateProviderUrlsAllowed();
  assertOidcEndpointUrl(issuer, { allowPrivate });

  const conventional = conventionalEndpoints(issuer);

  let document: Record<string, unknown> | null = null;
  try {
    const result = await oidcDiscoveryInternals.transport(
      new URL(`${issuer}/.well-known/openid-configuration`),
      {
        method: "GET",
        headers: { Accept: "application/json" },
        timeoutMs: options.timeoutMs ?? DISCOVERY_TIMEOUT_MS,
        allowPrivate,
        maxBodyBytes: DISCOVERY_MAX_BODY_BYTES,
      }
    );
    if (result.ok) {
      const parsed: unknown = JSON.parse(result.bodyText);
      if (parsed && typeof parsed === "object") document = parsed as Record<string, unknown>;
    }
  } catch {
    // Unreachable, blocked, redirected, timed out or unparsable: use the conventional endpoints.
    document = null;
  }

  if (!document) return conventional;

  // An OIDC Discovery document MUST carry `issuer`, and it MUST equal the issuer it was fetched
  // for. Anything else is the mix-up / substitution case: ignore the document rather than trust a
  // single endpoint it names.
  if (typeof document.issuer !== "string" || normalizeIssuer(document.issuer) !== issuer) {
    console.warn("[oidc] discovery document issuer mismatch — using conventional endpoints");
    return conventional;
  }

  const pick = (key: string, fallback: string): string => {
    const candidate = document[key];
    if (typeof candidate !== "string" || candidate.length === 0) return fallback;
    try {
      return assertOidcEndpointUrl(candidate, { allowPrivate }).toString();
    } catch (error) {
      const reason = error instanceof OidcEndpointError ? error.reason : "invalid_url";
      console.warn(`[oidc] discovery ${key} rejected (${reason}) — using conventional endpoint`);
      return fallback;
    }
  };

  return {
    authorizationEndpoint: pick("authorization_endpoint", conventional.authorizationEndpoint),
    tokenEndpoint: pick("token_endpoint", conventional.tokenEndpoint),
    jwksUri: pick("jwks_uri", conventional.jwksUri),
    source: "discovery",
  };
}

/**
 * POST the authorization-code exchange to a (re-)validated token endpoint through the pinned
 * transport. Returns the raw result; the caller parses the token set.
 */
export async function postOidcTokenRequest(
  tokenEndpoint: string,
  form: URLSearchParams,
  options: OidcNetworkOptions = {}
): Promise<OidcTransportResult> {
  const allowPrivate = options.allowPrivate ?? arePrivateProviderUrlsAllowed();
  const url = assertOidcEndpointUrl(tokenEndpoint, { allowPrivate });
  return oidcDiscoveryInternals.transport(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
    timeoutMs: options.timeoutMs ?? TOKEN_TIMEOUT_MS,
    allowPrivate,
    maxBodyBytes: TOKEN_MAX_BODY_BYTES,
  });
}
