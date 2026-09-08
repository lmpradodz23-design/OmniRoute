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
