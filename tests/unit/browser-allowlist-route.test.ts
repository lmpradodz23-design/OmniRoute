/**
 * GET/PUT /api/browser/allowlist — configuração persistida da allowlist do Browser Use, e o
 * efeito dela em POST /api/browser/check quando o corpo omite `allowedDomains`.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { getDbInstance } = await import("../../src/lib/db/core.ts");
const flags = await import("../../src/lib/db/featureFlags.ts");
const allowlist = await import("../../src/app/api/browser/allowlist/route.ts");
const browserCheck = await import("../../src/app/api/browser/check/route.ts");

const URL_ALLOWLIST = "http://localhost/api/browser/allowlist";

function put(body: unknown): Request {
  return new Request(URL_ALLOWLIST, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function check(url: string): Request {
  return new Request("http://localhost/api/browser/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: { kind: "navigate", url, origin: "user" } }),
  });
}

function reset(): void {
  getDbInstance()
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run("browser", "allowed_domains");
}

interface AllowlistBody {
  allowedDomains: string[];
  enabled: boolean;
  maxDomains: number;
}

interface VerdictBody {
  verdict: { decision: string };
  allowedDomains: string[];
}

test("GET sem configuração: lista vazia, flag e teto; não é gated pela flag", async () => {
  reset();
  flags.setFeatureFlagOverride("BROWSER_USE_ENABLED", "false");
  const res = await allowlist.GET(new Request(URL_ALLOWLIST));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()) as AllowlistBody, {
    allowedDomains: [],
    enabled: false,
    maxDomains: 256,
  });
});

test("PUT normaliza e o GET seguinte devolve a mesma lista (roundtrip)", async () => {
  reset();
  flags.setFeatureFlagOverride("BROWSER_USE_ENABLED", "true");
  const saved = await allowlist.PUT(
    put({ allowedDomains: [" Example.com", ".docs.example.org", "example.com"] })
  );
  assert.equal(saved.status, 200);
  const body = (await saved.json()) as AllowlistBody;
  assert.deepEqual(body.allowedDomains, ["example.com", "docs.example.org"]);
  assert.equal(body.enabled, true);

  const read = await allowlist.GET(new Request(URL_ALLOWLIST));
  assert.deepEqual(((await read.json()) as AllowlistBody).allowedDomains, [
    "example.com",
    "docs.example.org",
  ]);
});

test("PUT com domínio inválido → 400 com índice + motivo, sem ecoar o valor e sem gravar", async () => {
  reset();
  await allowlist.PUT(put({ allowedDomains: ["kept.com"] }));
  const res = await allowlist.PUT(
    put({ allowedDomains: ["ok.com", "https://evil.example/x", "169.254.169.254", "*.a.com"] })
  );
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.equal(text.includes("evil.example"), false);
  assert.deepEqual(JSON.parse(text), {
    error: "One or more domains are invalid",
    code: "invalid_domains",
    invalid: [
      { index: 1, reason: "invalid_characters" },
      { index: 2, reason: "ip_literal" },
      { index: 3, reason: "invalid_characters" },
    ],
  });
  const read = await allowlist.GET(new Request(URL_ALLOWLIST));
  assert.deepEqual(((await read.json()) as AllowlistBody).allowedDomains, ["kept.com"]);
});

test("PUT com chave desconhecida, tipo errado, corpo ausente ou lista grande demais → 400", async () => {
  const bodies: unknown[] = [
    { allowedDomains: ["example.com"], enabled: true },
    { allowedDomains: "example.com" },
    { allowedDomains: [42] },
    {},
    "not json",
    { allowedDomains: Array.from({ length: 257 }, (_, i) => `d${i}.example.com`) },
  ];
  for (const body of bodies) {
    const res = await allowlist.PUT(put(body));
    assert.equal(res.status, 400, `body ${JSON.stringify(body).slice(0, 60)} must be rejected`);
    const json = (await res.json()) as { code: string };
    assert.equal(json.code, "invalid_body");
  }
});

test("PUT [] limpa a allowlist", async () => {
  await allowlist.PUT(put({ allowedDomains: ["example.com"] }));
  const res = await allowlist.PUT(put({ allowedDomains: [] }));
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as AllowlistBody).allowedDomains, []);
});

test("após o PUT, /api/browser/check sem allowedDomains usa a lista persistida", async () => {
  reset();
  flags.setFeatureFlagOverride("BROWSER_USE_ENABLED", "true");
  const saved = await allowlist.PUT(put({ allowedDomains: ["example.com"] }));
  assert.equal(saved.status, 200);

  const allowed = await browserCheck.POST(check("https://docs.example.com/page"));
  assert.equal(allowed.status, 200);
  const allowedBody = (await allowed.json()) as VerdictBody;
  assert.equal(allowedBody.verdict.decision, "allow");
  assert.deepEqual(allowedBody.allowedDomains, ["example.com"]);

  const denied = await browserCheck.POST(check("https://evil.test/"));
  assert.equal(((await denied.json()) as VerdictBody).verdict.decision, "deny");

  // limpar a lista volta a negar o host antes permitido
  await allowlist.PUT(put({ allowedDomains: [] }));
  const cleared = await browserCheck.POST(check("https://docs.example.com/page"));
  assert.equal(((await cleared.json()) as VerdictBody).verdict.decision, "deny");
});
