/**
 * db/browserGuard.ts — escrita e leitura da allowlist persistida do Browser Use.
 *
 * Contrato: a escrita normaliza (trim, minúsculas, pontos nas pontas), colapsa duplicatas e é
 * tudo-ou-nada — uma entrada inválida (esquema, caminho, porta, userinfo, curinga, IP, rótulo
 * único, rótulo malformado, não-ASCII) rejeita a lista inteira informando índice + motivo. A
 * leitura é fail-closed: valor corrompido vira `[]` e entrada guardada fora da regra é descartada.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { getDbInstance } = await import("../../src/lib/db/core.ts");
const guard = await import("../../src/lib/db/browserGuard.ts");

function writeRaw(value: string): void {
  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run("browser", "allowed_domains", value);
}

function reset(): void {
  getDbInstance()
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run("browser", "allowed_domains");
}

test("sem linha persistida a allowlist é vazia", () => {
  reset();
  assert.deepEqual(guard.getBrowserAllowedDomains(), []);
});

test("escrita normaliza caixa, espaços, pontos iniciais e o ponto final de FQDN", () => {
  reset();
  const result = guard.setBrowserAllowedDomains([
    "  Example.COM ",
    ".docs.example.org",
    "..api.example.net.",
    "xn--bcher-kva.example",
  ]);
  const expected = ["example.com", "docs.example.org", "api.example.net", "xn--bcher-kva.example"];
  assert.deepEqual(result, { kind: "saved", allowedDomains: expected });
  assert.deepEqual(guard.getBrowserAllowedDomains(), expected);
});

test("duplicatas após normalizar são colapsadas, mantendo a primeira ordem", () => {
  reset();
  const result = guard.setBrowserAllowedDomains(["b.com", "A.com", "a.com", ".b.com", "a.com."]);
  assert.equal(result.kind, "saved");
  assert.deepEqual(guard.getBrowserAllowedDomains(), ["b.com", "a.com"]);
});

test("lista vazia é válida e grava allowlist vazia (nega tudo)", () => {
  guard.setBrowserAllowedDomains(["example.com"]);
  assert.deepEqual(guard.setBrowserAllowedDomains([]), { kind: "saved", allowedDomains: [] });
  assert.deepEqual(guard.getBrowserAllowedDomains(), []);
});

const REJECTIONS: Array<[string, string]> = [
  ["", "empty"],
  ["   ", "empty"],
  ["...", "empty"],
  ["https://example.com", "invalid_characters"],
  ["example.com/path", "invalid_characters"],
  ["example.com:8443", "invalid_characters"],
  ["user@example.com", "invalid_characters"],
  ["*.example.com", "invalid_characters"],
  ["example.com?x=1", "invalid_characters"],
  ["exa mple.com", "invalid_characters"],
  ["[::1]", "invalid_characters"],
  ["::1", "invalid_characters"],
  ["exa%6dple.com", "invalid_characters"],
  ["bücher.example", "non_ascii"],
  ["169.254.169.254", "ip_literal"],
  ["10.0.0.1", "ip_literal"],
  ["10.1", "ip_literal"],
  ["localhost", "single_label"],
  ["com", "single_label"],
  ["a..b.com", "invalid_label"],
  ["-bad.com", "invalid_label"],
  ["bad-.com", "invalid_label"],
  ["under_score.com", "invalid_label"],
  [`${"a".repeat(64)}.com`, "invalid_label"],
  [`${"a.".repeat(127)}com`, "too_long"],
];

for (const [raw, reason] of REJECTIONS) {
  const label = raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;
  test(`rejeita ${JSON.stringify(label)} como ${reason}`, () => {
    const result = guard.setBrowserAllowedDomains([raw]);
    assert.deepEqual(result, { kind: "invalid", invalid: [{ index: 0, reason }] });
  });
}

test("tudo-ou-nada: uma entrada inválida não grava nada e informa só índice + motivo", () => {
  reset();
  guard.setBrowserAllowedDomains(["kept.example.com"]);
  const result = guard.setBrowserAllowedDomains([
    "ok.com",
    "http://bad.com",
    "fine.org",
    "1.2.3.4",
  ]);
  assert.deepEqual(result, {
    kind: "invalid",
    invalid: [
      { index: 1, reason: "invalid_characters" },
      { index: 3, reason: "ip_literal" },
    ],
  });
  assert.equal(JSON.stringify(result).includes("bad.com"), false, "never echoes the value");
  assert.deepEqual(guard.getBrowserAllowedDomains(), ["kept.example.com"]);
});

test("mais de MAX_DOMAINS domínios distintos é recusado sem gravar", () => {
  reset();
  const max = guard.BROWSER_ALLOWLIST_MAX_DOMAINS;
  assert.equal(max, 256);
  const tooMany = Array.from({ length: max + 1 }, (_, i) => `d${i}.example.com`);
  assert.deepEqual(guard.setBrowserAllowedDomains(tooMany), { kind: "too_many", max });
  assert.deepEqual(guard.getBrowserAllowedDomains(), []);
  // duplicatas não contam contra o teto
  const withDupes = [...tooMany.slice(0, max), "D0.example.com"];
  assert.equal(guard.setBrowserAllowedDomains(withDupes).kind, "saved");
  assert.equal(guard.getBrowserAllowedDomains().length, max);
});

test("leitura fail-closed: JSON inválido, não-array e não-string viram vazio", () => {
  writeRaw("{not json");
  assert.deepEqual(guard.getBrowserAllowedDomains(), []);
  writeRaw(JSON.stringify({ domains: ["example.com"] }));
  assert.deepEqual(guard.getBrowserAllowedDomains(), []);
  writeRaw(JSON.stringify([42, null, { a: 1 }]));
  assert.deepEqual(guard.getBrowserAllowedDomains(), []);
});

test("leitura descarta entradas guardadas fora da regra em vez de ampliá-las", () => {
  writeRaw(
    JSON.stringify(["EXAMPLE.com", "*.evil.com", "10.0.0.1", "localhost", "example.com", 7])
  );
  assert.deepEqual(guard.getBrowserAllowedDomains(), ["example.com"]);
  reset();
});
