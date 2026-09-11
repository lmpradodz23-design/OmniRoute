// API keys brought in by the two legacy-JSON paths — the startup db.json migration in
// core.ts and the dashboard "Import JSON" (runJsonMigration) — used to be written with
// only the `key` column. validateApiKey() and getApiKeyMetadata() resolve rows by
// `key_hash`, so every imported key was invisible to auth: it authenticated nothing and
// the API Manager could not describe it. This suite drives both paths against a real
// database and asserts the imported keys actually work.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-json-import-keys-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.API_KEY_SECRET = "test-secret-json-import";

// Startup path: db.json must exist BEFORE the database module initialises.
const STARTUP_KEY = "omni_startup_legacy_key_0001";
fs.writeFileSync(
  path.join(TEST_DATA_DIR, "db.json"),
  JSON.stringify({
    apiKeys: [
      {
        id: "startup-key",
        name: "Startup Legacy Key",
        key: STARTUP_KEY,
        allowedModels: ["ollama-cloud/*"],
      },
    ],
  })
);

const core = await import("../../src/lib/db/core.ts");
const apiKeys = await import("../../src/lib/db/apiKeys.ts");
const jsonMigration = await import("../../src/lib/db/jsonMigration.ts");

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("keys migrated from a legacy db.json at startup authenticate and expose metadata", async () => {
  const db = core.getDbInstance();
  assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, "db.json.migrated")), true);

  const row = db
    .prepare("SELECT key_hash, key_prefix FROM api_keys WHERE id = ?")
    .get("startup-key") as { key_hash: string | null; key_prefix: string | null };
  assert.equal(row.key_hash, sha256(STARTUP_KEY), "row is addressable by its key hash");
  assert.equal(row.key_prefix, STARTUP_KEY.slice(0, 12));

  assert.equal(await apiKeys.validateApiKey(STARTUP_KEY), true, "the migrated key authenticates");
  const metadata = await apiKeys.getApiKeyMetadata(STARTUP_KEY);
  assert.ok(metadata, "metadata resolves for the migrated key");
  assert.equal(metadata.name, "Startup Legacy Key");
  assert.equal(metadata.modelAccessMode, "restricted", "legacy allowedModels implies restricted");
});

test("keys imported through runJsonMigration authenticate and keep their access mode", async () => {
  const IMPORTED_KEY = "omni_imported_restricted_key_0002";
  jsonMigration.runJsonMigration(core.getDbInstance(), {
    apiKeys: [
      {
        id: "imported-key",
        name: "Imported Key",
        key: IMPORTED_KEY,
        modelAccessMode: "restricted",
        allowedModels: [],
      },
    ],
  });
  apiKeys.resetApiKeyState();

  assert.equal(await apiKeys.validateApiKey(IMPORTED_KEY), true, "the imported key authenticates");
  const metadata = await apiKeys.getApiKeyMetadata(IMPORTED_KEY);
  assert.ok(metadata);
  assert.equal(metadata.modelAccessMode, "restricted");
  assert.deepEqual(metadata.allowedModels, []);
  assert.equal(await apiKeys.isModelAllowedForKey(IMPORTED_KEY, "openai/gpt-4.1"), false);
});

test("an undecryptable ciphertext is imported verbatim without a hash instead of aborting", () => {
  const db = core.getDbInstance();
  jsonMigration.runJsonMigration(db, {
    apiKeys: [{ id: "opaque-key", name: "Opaque", key: "enc:v1:not-decryptable-here" }],
  });
  const row = db.prepare("SELECT key, key_hash FROM api_keys WHERE id = ?").get("opaque-key") as {
    key: string;
    key_hash: string | null;
  };
  assert.equal(row.key, "enc:v1:not-decryptable-here");
  assert.equal(row.key_hash, null, "no hash is derived from ciphertext");
});
