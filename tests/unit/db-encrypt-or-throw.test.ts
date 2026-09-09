/**
 * Regression tests for finding #3 — fail-closed storage encryption.
 *
 * `encrypt()` returned plaintext passthrough without a key, so credential writers persisted
 * secrets in plaintext while believing they had encrypted. The new fail-closed contract
 * (`encryptOrThrow` / `encryptSensitive` / `assertStorageEncryptionConfigured`) rejects a
 * sensitive write (and refuses startup) in an exposed/production profile with no valid key.
 *
 * NOTE: the module memoizes the derived key, so the no-key assertions run BEFORE any key is set.
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
delete process.env.STORAGE_ENCRYPTION_KEY;
delete process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION;

const {
  EncryptionUnavailableError,
  assertStorageEncryptionConfigured,
  encryptOrThrow,
  encryptSensitive,
  isStorageEncryptionRequired,
} = await import("../../src/lib/db/encryption.ts");

test("encryptOrThrow throws (never passthrough) without a key", () => {
  delete process.env.STORAGE_ENCRYPTION_KEY;
  assert.throws(() => encryptOrThrow("super-secret"), EncryptionUnavailableError);
});

test("encryptOrThrow rejects empty input", () => {
  assert.throws(() => encryptOrThrow(""), TypeError);
});

test("required profile + no key: encryptSensitive AND startup gate fail closed", () => {
  delete process.env.STORAGE_ENCRYPTION_KEY;
  process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION = "true"; // explicit opt-in wins over test ctx
  try {
    assert.equal(isStorageEncryptionRequired(), true);
    assert.throws(() => encryptSensitive("super-secret"), EncryptionUnavailableError);
    assert.throws(() => assertStorageEncryptionConfigured(), EncryptionUnavailableError);
  } finally {
    delete process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION;
  }
});

test("dev/test profile (not required) + no key: passthrough + startup gate is a no-op", () => {
  delete process.env.STORAGE_ENCRYPTION_KEY;
  delete process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION;
  assert.equal(isStorageEncryptionRequired(), false);
  assert.equal(encryptSensitive("super-secret"), "super-secret"); // dev passthrough
  assert.doesNotThrow(() => assertStorageEncryptionConfigured());
});

test("with a key: encryptOrThrow and encryptSensitive produce real ciphertext", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "test-key-for-encrypt-or-throw-0123456789abcdef";
  const c = encryptOrThrow("super-secret");
  assert.ok(c.startsWith("enc:v1:"), "ciphertext expected");
  assert.notEqual(c, "super-secret");
  assert.ok((encryptSensitive("another") as string).startsWith("enc:v1:"));
  // Idempotent: already-encrypted stays as-is.
  assert.equal(encryptOrThrow(c), c);
});
