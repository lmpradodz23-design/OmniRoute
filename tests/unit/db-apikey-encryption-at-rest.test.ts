/**
 * Regression tests for finding #7 — API keys recoverable from a DB copy.
 *
 * Proves:
 *  - the `key` column is stored as `enc:v1:` ciphertext (never the usable plaintext),
 *  - validation works by key_hash only (no plaintext match), so an encrypted column still authenticates,
 *  - internal readers (getApiKeys/getApiKeyById) still see the plaintext (decrypt-on-read),
 *  - the idempotent backfill encrypts pre-existing plaintext rows and the key keeps validating,
 *  - regenerate stores ciphertext and rotates the validating key.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-apikey-enc-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.STORAGE_ENCRYPTION_KEY = "test-key-for-apikey-at-rest-0123456789abcdefghij";
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "test-api-key-secret-for-crc-0123456789";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");

function rawKeyColumn(id: string): string | null {
  const row = core
    .getDbInstance()
    .prepare("SELECT key FROM api_keys WHERE id = ?")
    .get(id) as { key: string | null } | undefined;
  return row?.key ?? null;
}

after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("API key encryption at rest (#7)", () => {
  it("createApiKey stores ciphertext; validation and internal readers still see plaintext", async () => {
    const created = await apiKeysDb.createApiKey("k1", "1111111111111111", ["manage"]);
    const plaintext = created.key;

    const stored = rawKeyColumn(created.id);
    assert.ok(stored?.startsWith("enc:v1:"), "the key column must hold ciphertext at rest");
    assert.notEqual(stored, plaintext, "plaintext key must never be at rest");

    assert.equal(await apiKeysDb.validateApiKey(plaintext), true, "hash-only validation works");

    const byId = await apiKeysDb.getApiKeyById(created.id);
    assert.equal(byId?.key, plaintext, "internal reader decrypts to the usable plaintext");
  });

  it("backfill encrypts a pre-existing plaintext row, idempotently; the key keeps validating", async () => {
    const created = await apiKeysDb.createApiKey("k2", "2222222222222222", ["chat"]);
    const plaintext = created.key;

    // Simulate a legacy row: force the key back to plaintext at rest (hash column stays intact).
    core.getDbInstance().prepare("UPDATE api_keys SET key = ? WHERE id = ?").run(plaintext, created.id);
    assert.equal(rawKeyColumn(created.id), plaintext, "row starts as plaintext at rest");
    assert.equal(await apiKeysDb.validateApiKey(plaintext), true);

    const migrated = apiKeysDb.encryptExistingApiKeyPlaintext();
    assert.ok(migrated >= 1, "at least the forced row is migrated");
    assert.ok(rawKeyColumn(created.id)?.startsWith("enc:v1:"), "now ciphertext at rest");
    assert.equal(await apiKeysDb.validateApiKey(plaintext), true, "still validates after migration");

    assert.equal(apiKeysDb.encryptExistingApiKeyPlaintext(), 0, "second backfill run is a no-op");
  });

  it("regenerate stores ciphertext and rotates the validating key", async () => {
    const created = await apiKeysDb.createApiKey("k3", "3333333333333333", ["manage"]);
    const oldKey = created.key;

    const regen = await apiKeysDb.regenerateApiKey(created.id);
    assert.ok(regen, "regenerate returns the new key");
    assert.ok(rawKeyColumn(created.id)?.startsWith("enc:v1:"), "rotated key is ciphertext at rest");
    assert.equal(await apiKeysDb.validateApiKey(regen!.key), true, "new key validates");
    assert.equal(await apiKeysDb.validateApiKey(oldKey), false, "old key no longer validates");
  });
});
