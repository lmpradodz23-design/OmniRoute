/**
 * Regression test for the #3 writer sweep — persistSecret() encrypts at rest.
 *
 * This store backs the Electron `login:start` flow (persists extracted provider credentials), so a
 * plaintext-at-rest here means a DB/backup copy leaks provider tokens. Values must be ciphertext at
 * rest and round-trip through decrypt-on-read; legacy plaintext rows keep working.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-db-secrets-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.STORAGE_ENCRYPTION_KEY = "test-key-for-db-secrets-0123456789abcdefghijklmn";

const core = await import("../../src/lib/db/core.ts");
const { persistSecret, getPersistedSecret } = await import("../../src/lib/db/secrets.ts");

function rawSecretColumn(key: string): string | null {
  const row = core
    .getDbInstance()
    .prepare("SELECT value FROM key_value WHERE namespace = 'secrets' AND key = ?")
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("persistSecret encryption at rest (#3 sweep)", () => {
  it("stores ciphertext at rest and round-trips on read", () => {
    const payload = JSON.stringify({ token: "SUPER-SECRET-TOKEN" });
    persistSecret("provider-x", payload);

    const raw = rawSecretColumn("provider-x");
    assert.ok(raw, "row must exist");
    assert.ok(raw!.includes("enc:v1:"), "the value must be ciphertext at rest");
    assert.ok(!raw!.includes("SUPER-SECRET-TOKEN"), "plaintext must never be at rest");

    assert.equal(getPersistedSecret("provider-x"), payload, "decrypts back to the original value");
  });

  it("reads a legacy plaintext row unchanged (decrypt passthrough)", () => {
    // Simulate a pre-#3 row: value stored as JSON of the plaintext string, no encryption.
    core
      .getDbInstance()
      .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('secrets', ?, ?)")
      .run("legacy-y", JSON.stringify("legacy-plain-secret"));
    assert.equal(getPersistedSecret("legacy-y"), "legacy-plain-secret");
  });
});
