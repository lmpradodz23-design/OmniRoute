/**
 * B-H1 / B-L2 — the agent's Nostr secret key at rest.
 *
 * - Written through `encryptSensitive` (ciphertext with STORAGE_ENCRYPTION_KEY, stable across reads);
 * - a legacy plaintext row is migrated to ciphertext on first read;
 * - fail-closed: in a profile that requires encryption, no plaintext is ever persisted;
 * - `key_value` namespace `buzz` is part of the storage-encryption audit;
 * - reading status with BUZZ_HUB_ENABLED off never mints/persists an identity (B-L2).
 *
 * Test order matters: the fail-closed case runs BEFORE any key is derived, because
 * encryption.ts caches the derived key for the process lifetime.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-buzz-sk-"));
const ORIGINAL = {
  DATA_DIR: process.env.DATA_DIR,
  STORAGE_ENCRYPTION_KEY: process.env.STORAGE_ENCRYPTION_KEY,
  OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION: process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION,
  BUZZ_HUB_ENABLED: process.env.BUZZ_HUB_ENABLED,
};
process.env.DATA_DIR = TEST_DATA_DIR;
delete process.env.STORAGE_ENCRYPTION_KEY;
delete process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION;
delete process.env.BUZZ_HUB_ENABLED;

const core = await import("../../src/lib/db/core.ts");
const encryption = await import("../../src/lib/db/encryption.ts");
const audit = await import("../../src/lib/db/storageEncryptionAudit.ts");
const buzz = await import("../../src/lib/buzzService.ts");

function resetStorage(): void {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function readStoredKeyRow(): string | undefined {
  const row = core
    .getDbInstance()
    .prepare("SELECT value FROM key_value WHERE namespace = 'buzz' AND key = 'agent_sk'")
    .get() as { value: string } | undefined;
  return row?.value;
}

test.beforeEach(() => resetStorage());

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("fail-closed: encryption required but no key -> generating the identity throws and stores nothing", () => {
  // Open the store first: the boot gate (assertStorageEncryptionConfigured) is a separate,
  // already-covered check. This test targets the WRITE path of the Buzz identity.
  core.getDbInstance();
  process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION = "true";
  try {
    assert.throws(() => buzz.getOrCreateAgentSecretKey(), encryption.EncryptionUnavailableError);
    assert.equal(readStoredKeyRow(), undefined, "no plaintext row may be written");
  } finally {
    delete process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION;
  }
});

test("B-L2: status with BUZZ_HUB_ENABLED off reads only — no identity is minted or persisted", () => {
  delete process.env.BUZZ_HUB_ENABLED;
  const status = buzz.getBuzzStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.agentPubkey, null, "no pubkey before the hub is activated");
  assert.equal(readStoredKeyRow(), undefined, "GET must not persist a key as a side effect");
  assert.equal(buzz.getAgentSecretKey(), null);
});

test("B-L2: activating the hub (flag on) creates the identity once; flag off keeps reporting it", () => {
  process.env.BUZZ_HUB_ENABLED = "true";
  try {
    const first = buzz.getBuzzStatus();
    assert.match(first.agentPubkey ?? "", /^[0-9a-f]{64}$/);
    assert.ok(readStoredKeyRow(), "activation persists the key");
    delete process.env.BUZZ_HUB_ENABLED;
    const later = buzz.getBuzzStatus();
    assert.equal(later.agentPubkey, first.agentPubkey, "existing identity is reported read-only");
  } finally {
    delete process.env.BUZZ_HUB_ENABLED;
  }
});

test("B-H1: with STORAGE_ENCRYPTION_KEY the stored key is ciphertext and stable across reads", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "buzz-test-storage-key-0123456789abcdef";
  assert.equal(encryption.isEncryptionEnabled(), true);
  const k1 = buzz.getOrCreateAgentSecretKey();
  const k2 = buzz.getOrCreateAgentSecretKey();
  assert.match(k1, /^[0-9a-f]{64}$/);
  assert.equal(k1, k2, "stable key across reads");
  const stored = readStoredKeyRow();
  assert.ok(
    encryption.looksEncrypted(stored),
    `row must be enc:v1 ciphertext, got ${stored?.slice(0, 12)}`
  );
  assert.notEqual(stored, k1, "plaintext secret never at rest");
  assert.equal(encryption.decrypt(stored), k1);
  assert.equal(buzz.getBuzzStatus().agentPubkey?.length, 64);
});

test("B-H1: a legacy plaintext key row is migrated to ciphertext on first read (same key)", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "buzz-test-storage-key-0123456789abcdef";
  const legacy = "ab".repeat(32);
  core
    .getDbInstance()
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'agent_sk', ?)"
    )
    .run(legacy);
  assert.equal(buzz.getAgentSecretKey(), legacy, "legacy value keeps working");
  const migrated = readStoredKeyRow();
  assert.ok(encryption.looksEncrypted(migrated), "legacy row re-written as ciphertext");
  assert.equal(encryption.decrypt(migrated), legacy);
  assert.equal(buzz.getOrCreateAgentSecretKey(), legacy, "identity did not change");
});

test("B-H1: an undecryptable ciphertext (rotated key) fails closed instead of minting a new identity", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "buzz-test-storage-key-0123456789abcdef";
  core
    .getDbInstance()
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'agent_sk', ?)"
    )
    .run("enc:v1:00112233445566778899aabbccddeeff:deadbeef:00112233445566778899aabbccddeeff");
  assert.throws(() => buzz.getAgentSecretKey(), /undecryptable|STORAGE_ENCRYPTION_KEY/);
  assert.throws(() => buzz.getOrCreateAgentSecretKey(), /undecryptable|STORAGE_ENCRYPTION_KEY/);
  assert.ok(encryption.looksEncrypted(readStoredKeyRow()), "row untouched (no silent rotation)");
});

test("storage audit: key_value namespace buzz/agent_sk is a sensitive column; plaintext counts as insecure", () => {
  const entry = audit.SENSITIVE_COLUMNS.find(
    (s) => s.table === "key_value" && /namespace\s*=\s*'buzz'/.test(s.where ?? "")
  );
  assert.ok(entry, "SENSITIVE_COLUMNS must cover key_value namespace 'buzz'");
  assert.match(entry!.where ?? "", /agent_sk/, "only the secret row, not relay_url, is sensitive");
  core
    .getDbInstance()
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'agent_sk', ?)"
    )
    .run("cd".repeat(32));
  core
    .getDbInstance()
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'relay_url', ?)"
    )
    .run("wss://relay.example");
  const result = audit.auditStorageEncryption();
  assert.equal(
    result.byColumn["key_value.value"],
    1,
    "the plaintext secret is counted; relay_url is not"
  );
});
