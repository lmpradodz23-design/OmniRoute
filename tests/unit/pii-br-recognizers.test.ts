import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DB isolado (não polui a base de produção).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-piibr-"));
process.env.DATA_DIR = tmpDir;
process.env.PII_RESPONSE_SANITIZATION_MODE = "redact";

async function enableAndSanitize(text: string): Promise<string> {
  const { setFeatureFlagOverride } = await import("@/lib/db/featureFlags");
  setFeatureFlagOverride("PII_RESPONSE_SANITIZATION", "true");
  const { sanitizePII } = await import("@/lib/piiSanitizer");
  return sanitizePII(text).text;
}

test("PII BR: CEP (NNNNN-NNN) é redigido", async () => {
  const out = await enableAndSanitize("Meu endereço tem CEP 01310-100 na Paulista.");
  assert.match(out, /\[CEP_REDACTED\]/);
  assert.doesNotMatch(out, /01310-100/);
});

test("PII BR: ZIP+4 dos EUA (NNNNN-NNNN) NÃO vira CEP (guarda de falso-positivo)", async () => {
  const out = await enableAndSanitize("US ZIP 12345-6789 here.");
  assert.doesNotMatch(out, /\[CEP_REDACTED\]/);
  assert.match(out, /12345-6789/);
});

test("PII BR: chave PIX aleatória (UUID) é redigida QUANDO há a pista 'pix'", async () => {
  const out = await enableAndSanitize(
    "Minha chave pix é 123e4567-e89b-42d3-a456-426614174000, pode pagar."
  );
  assert.match(out, /\[PIX_KEY_REDACTED\]/);
  assert.doesNotMatch(out, /123e4567-e89b-42d3-a456-426614174000/);
});

test("PII BR: UUID SEM contexto de pix NÃO é redigido (evita nuke de IDs no gateway)", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const out = await enableAndSanitize(`request_id=${id} trace ok`);
  assert.doesNotMatch(out, /\[PIX_KEY_REDACTED\]/);
  assert.ok(out.includes(id), "UUID comum deve permanecer intacto");
});

// ---- Regressoes da auditoria adversarial (2026-09-12) -----------------------

test("cep: identificadores hifenizados NAO sao corrompidos (sem a pista 'cep')", async () => {
  const casos = [
    "Pedido 12345-678 confirmado",
    "Rastreio 90210-123",
    "build 20250-912 ok",
    "id ABC-12345-678-X",
    "isbn 03064-063",
    "faixa 10000-500 reais",
  ];
  for (const texto of casos) {
    const out = await enableAndSanitize(texto);
    assert.equal(out, texto, `nao deveria redigir: ${texto}`);
  }
});

test("cep: com a pista 'CEP' por perto, redige", async () => {
  assert.match(await enableAndSanitize("CEP 01310-100"), /\[CEP_REDACTED\]/);
  assert.match(await enableAndSanitize("cep: 01310-100"), /\[CEP_REDACTED\]/);
  assert.match(await enableAndSanitize("meu CEP e 01310-100, pode anotar"), /\[CEP_REDACTED\]/);
});

test("pix: a pista vale DEPOIS da chave", async () => {
  assert.match(
    await enableAndSanitize("123e4567-e89b-42d3-a456-426614174000 e a minha chave pix"),
    /\[PIX_KEY_REDACTED\]/
  );
});

test("pix: a pista atravessa quebra de linha (formato de quem cola de um chat)", async () => {
  assert.match(
    await enableAndSanitize("chave Pix\n123e4567-e89b-42d3-a456-426614174000"),
    /\[PIX_KEY_REDACTED\]/
  );
});

test("pix: a pista a mais de 30 caracteres antes ainda pega", async () => {
  assert.match(
    await enableAndSanitize(
      "Chave pix para transferir o valor combinado ontem: 123e4567-e89b-42d3-a456-426614174000"
    ),
    /\[PIX_KEY_REDACTED\]/
  );
});

test("pix: UUID sem qualquer pista continua intacto", async () => {
  const texto = "request id 123e4567-e89b-42d3-a456-426614174000 falhou";
  assert.equal(await enableAndSanitize(texto), texto);
});
