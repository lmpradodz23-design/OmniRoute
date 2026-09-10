/**
 * Regression for SSRF finding S-4 (Fase 1): OIDC endpoint discovery and token exchange.
 *
 * The login/callback routes used to fetch the discovery document with plain `fetch` and accept
 * `authorization_endpoint` / `token_endpoint` / `jwks_uri` verbatim, so a substituted document
 * could send the browser's authorization code and the server's client_secret anywhere.
 *
 * Fully hermetic: the network layer is `oidcDiscoveryInternals.transport`, swapped for a stub
 * that serves canned documents and records every call. No DNS, no sockets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";

// The guard policy module can reach the settings store; keep any incidental DB away from real data.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-oidc-discovery-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const {
  OidcEndpointError,
  assertOidcEndpointUrl,
  discoverOidcEndpoints,
  normalizeIssuer,
  oidcDiscoveryInternals,
  postOidcTokenRequest,
} = await import("../../src/lib/auth/oidcDiscovery");
type OidcTransportOptions = import("../../src/lib/auth/oidcDiscovery").OidcTransportOptions;

after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may still hold a handle at teardown; the OS temp policy reclaims it.
  }
});

type Canned = { status: number; body: string };
type Handler = (url: URL) => Canned;

const realTransport = oidcDiscoveryInternals.transport;
let calls: Array<{ url: string; options: OidcTransportOptions }> = [];
let handler: Handler = () => ({ status: 404, body: "not found" });

beforeEach(() => {
  calls = [];
  handler = () => ({ status: 404, body: "not found" });
  oidcDiscoveryInternals.transport = async (url, options) => {
    calls.push({ url: url.toString(), options });
    const r = handler(url);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, bodyText: r.body };
  };
});

afterEach(() => {
  oidcDiscoveryInternals.transport = realTransport;
});

const ISSUER = "https://idp.example";
const discoveryDoc = (overrides: Record<string, unknown>) =>
  JSON.stringify({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    jwks_uri: `${ISSUER}/oauth/jwks`,
    ...overrides,
  });

describe("normalizeIssuer", () => {
  it("trims whitespace and trailing slashes", () => {
    assert.equal(normalizeIssuer("  https://idp.example///  "), "https://idp.example");
    assert.equal(normalizeIssuer("https://idp.example"), "https://idp.example");
  });
});

describe("assertOidcEndpointUrl — what an endpoint must be before it sees a code or a secret", () => {
  it("rejects plain http outside loopback", () => {
    assert.throws(
      () => assertOidcEndpointUrl("http://idp.example/token", { allowPrivate: true }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "https_required"
    );
  });

  it("allows plain http to a loopback host (local development IdP) under the opt-in", () => {
    const u = assertOidcEndpointUrl("http://127.0.0.1:8080/realms/x", { allowPrivate: true });
    assert.equal(u.hostname, "127.0.0.1");
  });

  it("rejects cloud-metadata hosts even with the opt-in", () => {
    for (const raw of ["https://169.254.169.254/token", "https://metadata.google.internal/token"]) {
      assert.throws(
        () => assertOidcEndpointUrl(raw, { allowPrivate: true }),
        (e: unknown) => e instanceof OidcEndpointError && e.reason === "metadata",
        raw
      );
    }
  });

  it("rejects a private host without the opt-in and admits it with the opt-in", () => {
    assert.throws(
      () => assertOidcEndpointUrl("https://10.0.0.5/token", { allowPrivate: false }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "private_without_optin"
    );
    assert.equal(assertOidcEndpointUrl("https://10.0.0.5/token", { allowPrivate: true }).hostname, "10.0.0.5");
  });

  it("rejects embedded credentials and non-http schemes", () => {
    for (const raw of ["https://user:pass@idp.example/token", "ftp://idp.example/token", "not a url"]) {
      assert.throws(
        () => assertOidcEndpointUrl(raw, { allowPrivate: true }),
        (e: unknown) => e instanceof OidcEndpointError && e.reason === "invalid_url",
        raw
      );
    }
  });

  it("accepts a normal public https endpoint", () => {
    assert.equal(assertOidcEndpointUrl("https://idp.example/token", { allowPrivate: false }).href, "https://idp.example/token");
  });
});

describe("discoverOidcEndpoints — the configured issuer itself is validated first", () => {
  it("throws for an http (non-loopback) issuer before any network call", async () => {
    await assert.rejects(
      discoverOidcEndpoints("http://idp.example", { allowPrivate: true }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "https_required"
    );
    assert.equal(calls.length, 0);
  });

  it("throws for a metadata issuer before any network call", async () => {
    await assert.rejects(
      discoverOidcEndpoints("https://169.254.169.254", { allowPrivate: true }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "metadata"
    );
    assert.equal(calls.length, 0);
  });

  it("throws for a private issuer without the opt-in; admits it with the opt-in", async () => {
    await assert.rejects(
      discoverOidcEndpoints("https://10.0.0.5", { allowPrivate: false }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "private_without_optin"
    );
    const eps = await discoverOidcEndpoints("https://10.0.0.5", { allowPrivate: true });
    assert.equal(eps.source, "conventional");
    assert.equal(eps.tokenEndpoint, "https://10.0.0.5/token");
  });

  it("admits a loopback http issuer (dev IdP) under the opt-in and fetches discovery with allowPrivate", async () => {
    const eps = await discoverOidcEndpoints("http://127.0.0.1:8080/realms/dev/", { allowPrivate: true });
    assert.equal(eps.source, "conventional");
    assert.equal(eps.authorizationEndpoint, "http://127.0.0.1:8080/realms/dev/authorize");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8080/realms/dev/.well-known/openid-configuration");
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.allowPrivate, true);
  });
});

describe("discoverOidcEndpoints — the discovery document is trusted only when its issuer matches", () => {
  it("falls back to conventional endpoints when discovery is unreachable or non-2xx", async () => {
    handler = () => ({ status: 404, body: "nope" });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.deepEqual(eps, {
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/jwks`,
      source: "conventional",
    });
  });

  it("falls back to conventional endpoints when the transport throws (blocked/redirect/timeout)", async () => {
    oidcDiscoveryInternals.transport = async () => {
      throw new Error("Redirect blocked");
    };
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "conventional");
  });

  it("ignores a document that carries no issuer", async () => {
    handler = () => ({
      status: 200,
      body: JSON.stringify({ token_endpoint: "https://attacker.example/token" }),
    });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "conventional");
    assert.equal(eps.tokenEndpoint, `${ISSUER}/token`, "an unverified document must not name the token endpoint");
  });

  it("ignores a document whose issuer differs from the configured one (mix-up / substitution)", async () => {
    handler = () => ({
      status: 200,
      body: discoveryDoc({ issuer: "https://other.example", token_endpoint: "https://attacker.example/token" }),
    });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "conventional");
    assert.equal(eps.tokenEndpoint, `${ISSUER}/token`);
  });

  it("ignores unparsable JSON", async () => {
    handler = () => ({ status: 200, body: "<html>not json</html>" });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "conventional");
  });

  it("uses a verified document, including https endpoints on another public host (Google-style)", async () => {
    handler = () => ({
      status: 200,
      body: discoveryDoc({
        token_endpoint: "https://oauth2.other-public.example/token",
        jwks_uri: "https://www.other-public.example/oauth2/v3/certs",
      }),
    });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "discovery");
    assert.equal(eps.authorizationEndpoint, `${ISSUER}/oauth/authorize`);
    assert.equal(eps.tokenEndpoint, "https://oauth2.other-public.example/token");
    assert.equal(eps.jwksUri, "https://www.other-public.example/oauth2/v3/certs");
  });

  it("accepts a trailing-slash issuer in the document as equal to the configured issuer", async () => {
    handler = () => ({ status: 200, body: discoveryDoc({ issuer: `${ISSUER}/` }) });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "discovery");
  });

  it("replaces an http (non-loopback) token_endpoint from a verified document with the conventional one", async () => {
    handler = () => ({ status: 200, body: discoveryDoc({ token_endpoint: "http://attacker.example/token" }) });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.source, "discovery");
    assert.equal(eps.tokenEndpoint, `${ISSUER}/token`, "client_secret must never be posted over plain http");
    assert.equal(eps.authorizationEndpoint, `${ISSUER}/oauth/authorize`, "valid siblings are still taken");
  });

  it("replaces a metadata endpoint from a verified document with the conventional one", async () => {
    handler = () => ({ status: 200, body: discoveryDoc({ jwks_uri: "https://169.254.169.254/jwks" }) });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: true });
    assert.equal(eps.jwksUri, `${ISSUER}/jwks`);
  });

  it("replaces a private endpoint from a verified document when the opt-in is off, keeps it when on", async () => {
    handler = () => ({ status: 200, body: discoveryDoc({ token_endpoint: "https://10.0.0.5/token" }) });
    const off = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(off.tokenEndpoint, `${ISSUER}/token`);
    const on = await discoverOidcEndpoints(ISSUER, { allowPrivate: true });
    assert.equal(on.tokenEndpoint, "https://10.0.0.5/token");
  });

  it("replaces an endpoint with embedded credentials", async () => {
    handler = () => ({ status: 200, body: discoveryDoc({ token_endpoint: "https://u:p@idp.example/token" }) });
    const eps = await discoverOidcEndpoints(ISSUER, { allowPrivate: false });
    assert.equal(eps.tokenEndpoint, `${ISSUER}/token`);
  });
});

describe("postOidcTokenRequest — the token endpoint is re-validated and posted through the transport", () => {
  it("rejects an http (non-loopback) token endpoint before any network call", async () => {
    await assert.rejects(
      postOidcTokenRequest("http://idp.example/token", new URLSearchParams({ a: "1" }), { allowPrivate: false }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "https_required"
    );
    assert.equal(calls.length, 0);
  });

  it("rejects a metadata token endpoint even with the opt-in", async () => {
    await assert.rejects(
      postOidcTokenRequest("https://169.254.169.254/token", new URLSearchParams(), { allowPrivate: true }),
      (e: unknown) => e instanceof OidcEndpointError && e.reason === "metadata"
    );
    assert.equal(calls.length, 0);
  });

  it("posts the form body with the OAuth content type and returns the raw result", async () => {
    handler = () => ({ status: 200, body: JSON.stringify({ id_token: "x.y.z" }) });
    const form = new URLSearchParams({ grant_type: "authorization_code", code: "abc" });
    const r = await postOidcTokenRequest(`${ISSUER}/token`, form, { allowPrivate: false });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.bodyText).id_token, "x.y.z");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ISSUER}/token`);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(calls[0].options.body, "grant_type=authorization_code&code=abc");
    assert.equal(calls[0].options.allowPrivate, false);
  });

  it("surfaces a non-2xx token response as ok:false without throwing", async () => {
    handler = () => ({ status: 400, body: "bad request" });
    const r = await postOidcTokenRequest(`${ISSUER}/token`, new URLSearchParams(), { allowPrivate: false });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });
});
