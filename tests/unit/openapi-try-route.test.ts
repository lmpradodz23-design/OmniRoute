import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-openapi-try-route-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.INITIAL_PASSWORD = "openapi-try-password";
process.env.JWT_SECRET = "openapi-try-jwt-secret";
// createApiKey() needs the CRC secret the startup validator normally provisions.
const ORIGINAL_API_KEY_SECRET = process.env.API_KEY_SECRET;
process.env.API_KEY_SECRET = "openapi-try-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const route = await import("../../src/app/api/openapi/try/route.ts");

const originalFetch = globalThis.fetch;

/** Response envelope of the route (validation errors nest `{ message }`, guard errors are plain). */
type TryBody = { error?: { message?: string } | string; status?: number };

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function createAuthCookie() {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret);
  return `auth_token=${token}`;
}

function makeRequest(body: unknown, cookie?: string) {
  return new Request("http://localhost/api/openapi/try", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test.beforeEach(async () => {
  await resetStorage();
  globalThis.fetch = originalFetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(() => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
  if (ORIGINAL_INITIAL_PASSWORD === undefined) {
    delete process.env.INITIAL_PASSWORD;
  } else {
    process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL_PASSWORD;
  }
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
  if (ORIGINAL_API_KEY_SECRET === undefined) {
    delete process.env.API_KEY_SECRET;
  } else {
    process.env.API_KEY_SECRET = ORIGINAL_API_KEY_SECRET;
  }
});

test("openapi try route requires management authentication before proxying", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  const response = await route.POST(
    makeRequest({
      method: "GET",
      path: "/api/monitoring/health",
    }) as never
  );
  const body = (await response.json()) as TryBody;

  assert.equal(response.status, 401);
  assert.equal(body.error.message, "Authentication required");
  assert.equal(fetchCalled, false);
});

test("openapi try route rejects protocol-relative targets after authentication", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  const response = await route.POST(
    makeRequest(
      {
        method: "GET",
        path: "//evil.example/api",
      },
      await createAuthCookie()
    ) as never
  );
  const body = (await response.json()) as TryBody;

  assert.equal(response.status, 400);
  assert.equal(body.error.message, "Invalid request");
  assert.equal(fetchCalled, false);
});

test("openapi try route strips hop-by-hop headers and proxies same-origin API paths", async () => {
  const cookie = await createAuthCookie();
  let fetchUrl = "";
  let fetchInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    fetchUrl = String(url);
    fetchInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const response = await route.POST(
    makeRequest(
      {
        method: "POST",
        path: "/api/combos/test",
        confirmMutation: true,
        headers: {
          Authorization: "Bearer test-key",
          Host: "evil.example",
          "X-Forwarded-Proto": "https",
        },
        body: { comboName: "smoke" },
      },
      cookie
    ) as never
  );
  const body = (await response.json()) as TryBody;
  const forwardedHeaders = fetchInit?.headers as Record<string, string>;

  assert.equal(response.status, 200);
  assert.equal(body.status, 200);
  assert.equal(fetchUrl, "http://localhost/api/combos/test");
  assert.equal(fetchInit?.method, "POST");
  assert.equal(forwardedHeaders.Authorization, "Bearer test-key");
  assert.equal(forwardedHeaders.Host, undefined);
  assert.equal(forwardedHeaders["X-Forwarded-Proto"], undefined);
  // #5 residual: the dashboard session is NEVER forwarded implicitly — the proxied call runs with
  // exactly the credentials the operator typed into the Try panel (explicit Authorization).
  assert.equal(forwardedHeaders.Cookie, undefined);
  assert.equal(forwardedHeaders.cookie, undefined);
});

test("openapi try route never forwards the session cookie, even when the caller supplies none of its own auth", async () => {
  const cookie = await createAuthCookie();
  let fetchInit: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    fetchInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const response = await route.POST(
    makeRequest({ method: "GET", path: "/api/monitoring/health" }, cookie) as never
  );
  assert.equal(response.status, 200);
  const forwardedHeaders = (fetchInit?.headers ?? {}) as Record<string, string>;
  assert.equal(
    Object.keys(forwardedHeaders).some((k) => k.toLowerCase() === "cookie"),
    false
  );
  assert.equal(
    Object.keys(forwardedHeaders).some((k) => k.toLowerCase() === "authorization"),
    false
  );
});

test("openapi try route refuses a mutating method without an explicit confirmMutation", async () => {
  const cookie = await createAuthCookie();
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await route.POST(
      makeRequest(
        {
          method,
          path: "/api/combos/test",
          headers: { Authorization: "Bearer test-key" },
          body: { comboName: "smoke" },
        },
        cookie
      ) as never
    );
    const body = (await response.json()) as TryBody;
    assert.equal(response.status, 403, method);
    assert.match(String(body.error), /confirmMutation/);
  }
  assert.equal(fetchCalled, false);
});

test("openapi try route only proxies operations documented in the OpenAPI spec (explicit allowlist)", async () => {
  const cookie = await createAuthCookie();
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("unexpected");
  };

  for (const target of [
    // Would only match the generated `/api/{omnirouteApiCatchAll}` placeholder, which is excluded.
    { method: "GET", path: "/api/does-not-exist-xyz" },
    // Documented path, undocumented method.
    { method: "PUT", path: "/api/health", confirmMutation: true },
    { method: "GET", path: "/v1/not-in-spec" },
  ]) {
    const response = await route.POST(makeRequest(target, cookie) as never);
    const body = (await response.json()) as TryBody;
    assert.equal(response.status, 403, `${target.method} ${target.path}`);
    assert.match(String(body.error), /not a documented/i);
  }
  assert.equal(fetchCalled, false);
});

test("openapi try route attaches a stored key by id server-side and never echoes it (#7 reveal-once)", async () => {
  const cookie = await createAuthCookie();
  const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
  const created = await apiKeysDb.createApiKey("Try It key", "1234567890abcdef");
  let fetchInit: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    fetchInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const response = await route.POST(
    makeRequest(
      { method: "GET", path: "/api/monitoring/health", apiKeyId: created.id },
      cookie
    ) as never
  );
  assert.equal(response.status, 200);
  const forwardedHeaders = (fetchInit?.headers ?? {}) as Record<string, string>;
  assert.equal(forwardedHeaders.Authorization, `Bearer ${created.key}`);
  assert.ok(!JSON.stringify(await response.json()).includes(created.key), "key never echoed");

  // An explicit Authorization wins over apiKeyId; an unknown id is a 404 with no proxied call.
  let fetchCalled = false;
  globalThis.fetch = async (_url, init) => {
    fetchCalled = true;
    fetchInit = init;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  await route.POST(
    makeRequest(
      {
        method: "GET",
        path: "/api/monitoring/health",
        apiKeyId: created.id,
        headers: { Authorization: "Bearer explicit" },
      },
      cookie
    ) as never
  );
  assert.equal((fetchInit?.headers as Record<string, string>).Authorization, "Bearer explicit");

  fetchCalled = false;
  const missing = await route.POST(
    makeRequest(
      { method: "GET", path: "/api/monitoring/health", apiKeyId: "nope" },
      cookie
    ) as never
  );
  assert.equal(missing.status, 404);
  assert.equal(fetchCalled, false);
});

test("openapi try route matches documented path templates ({id} parameters)", async () => {
  const cookie = await createAuthCookie();
  let fetchUrl = "";
  globalThis.fetch = async (url) => {
    fetchUrl = String(url);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const response = await route.POST(
    makeRequest(
      { method: "GET", path: "/api/keys/key_abc123", headers: { Authorization: "Bearer k" } },
      cookie
    ) as never
  );
  assert.equal(response.status, 200);
  assert.equal(fetchUrl, "http://localhost/api/keys/key_abc123");
});
