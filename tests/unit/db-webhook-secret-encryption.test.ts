/**
 * Regression tests for finding #8 — webhook signing secret must be encrypted at rest.
 *
 * Proves:
 *  - createWebhook / updateWebhook store the secret as `enc:v1:` ciphertext (never plaintext),
 *  - readers still see the plaintext (decrypt-on-read), so HMAC signing is unchanged,
 *  - the idempotent backfill encrypts pre-existing plaintext rows and preserves the signature.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-webhook-secret-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.STORAGE_ENCRYPTION_KEY = "test-encryption-key-for-webhook-secrets-0123456789";

const core = await import("../../src/lib/db/core.ts");
const { createWebhook, updateWebhook, getWebhook, encryptExistingWebhookSecrets } = await import(
  "../../src/lib/db/webhooks.ts"
);

function rawSecret(id: string): string | null {
  const row = core
    .getDbInstance()
    .prepare("SELECT secret FROM webhooks WHERE id = ?")
    .get(id) as { secret: string | null } | undefined;
  return row?.secret ?? null;
}

after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("webhook secret encryption at rest (#8)", () => {
  it("createWebhook stores ciphertext but readers see plaintext", () => {
    const wh = createWebhook({ url: "https://example.com/hook", secret: "whsec_known_ABC" });
    const stored = rawSecret(wh.id);
    assert.ok(stored?.startsWith("enc:v1:"), "DB column must hold ciphertext");
    assert.notEqual(stored, "whsec_known_ABC", "plaintext must never be at rest");
    assert.equal(getWebhook(wh.id)?.secret, "whsec_known_ABC", "reader decrypts to plaintext");
  });

  it("auto-generated secret is also encrypted at rest and round-trips", () => {
    const wh = createWebhook({ url: "https://example.com/hook2" });
    assert.ok(rawSecret(wh.id)?.startsWith("enc:v1:"));
    const plain = getWebhook(wh.id)?.secret;
    assert.ok(plain && plain.startsWith("whsec_"), "reader sees a usable plaintext secret");
  });

  it("updateWebhook re-encrypts a rotated secret", () => {
    const wh = createWebhook({ url: "https://example.com/hook3", secret: "whsec_old" });
    updateWebhook(wh.id, { secret: "whsec_new_rotated" });
    assert.ok(rawSecret(wh.id)?.startsWith("enc:v1:"));
    assert.equal(getWebhook(wh.id)?.secret, "whsec_new_rotated");
  });

  it("backfill encrypts a pre-existing plaintext row, idempotently, preserving the HMAC", () => {
    // Simulate a legacy row written before this fix (bypass createWebhook).
    const id = crypto.randomUUID();
    core
      .getDbInstance()
      .prepare(
        "INSERT INTO webhooks (id, url, events, secret, description, kind) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, "https://example.com/legacy", '["*"]', "whsec_legacy_plain", "", "custom");

    // Signature computed from the plaintext the readers expose (before migration).
    const payload = JSON.stringify({ event: "test" });
    const before = getWebhook(id)!.secret!;
    const sigBefore = crypto.createHmac("sha256", before).update(payload).digest("hex");
    assert.equal(before, "whsec_legacy_plain");
    assert.equal(rawSecret(id), "whsec_legacy_plain", "row starts as plaintext at rest");

    const migrated = encryptExistingWebhookSecrets();
    assert.equal(migrated, 1, "one plaintext row migrated");
    assert.ok(rawSecret(id)?.startsWith("enc:v1:"), "now ciphertext at rest");

    // Signature after migration must be identical (secret round-trips to the same plaintext).
    const after = getWebhook(id)!.secret!;
    const sigAfter = crypto.createHmac("sha256", after).update(payload).digest("hex");
    assert.equal(sigAfter, sigBefore, "HMAC signature preserved across migration");

    // Idempotent: a second run migrates nothing.
    assert.equal(encryptExistingWebhookSecrets(), 0, "second backfill run is a no-op");
  });
});
