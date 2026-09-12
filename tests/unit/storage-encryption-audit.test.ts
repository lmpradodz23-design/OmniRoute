/**
 * Finding #3 residual — readiness must DETECT insecure storage. `auditStorageEncryption`
 * counts, per sensitive column, non-empty values without the `enc:v1:` prefix; values are never
 * returned. `buildStorageReadiness` turns that into the `storage` section of the management
 * health view.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-storage-audit-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
delete process.env.STORAGE_ENCRYPTION_KEY;
delete process.env.OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION;

const core = await import("../../src/lib/db/core.ts");
const { auditStorageEncryption, buildStorageReadiness, SENSITIVE_COLUMNS } =
  await import("../../src/lib/db/storageEncryptionAudit.ts");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("an empty store scans every sensitive column and reports encryption_disabled without a key", () => {
  const audit = auditStorageEncryption();
  assert.equal(audit.insecureRows, 0);
  assert.deepEqual(audit.byColumn, {});
  const expected = SENSITIVE_COLUMNS.flatMap((s) => s.columns.map((c) => `${s.table}.${c}`));
  for (const label of expected) {
    assert.ok(audit.scanned.includes(label), `${label} must be scanned on the current schema`);
  }
  assert.deepEqual(audit.skipped, []);

  const readiness = buildStorageReadiness({ NODE_ENV: "development" });
  assert.equal(readiness.encryptionConfigured, false);
  assert.equal(readiness.status, "encryption_disabled");
  assert.equal(readiness.exposed, true, "default 0.0.0.0 bind is exposed");
  assert.equal(readiness.bindHostExplicit, false);
});

test("plaintext sensitive values are counted per column and never returned", () => {
  const db = core.getDbInstance();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO provider_connections (id, provider, auth_type, name, api_key, access_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("pc-plain", "openai", "apikey", "plain", "sk-plaintext-secret", "tok-plaintext", now, now);
  db.prepare(
    "INSERT INTO provider_connections (id, provider, auth_type, name, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("pc-enc", "openai", "apikey", "enc", "enc:v1:aa:bb:cc", now, now);
  db.prepare("INSERT INTO webhooks (id, url, secret) VALUES (?, ?, ?)").run(
    "wh-1",
    "https://example.com/h",
    "whsec-plain"
  );

  const audit = auditStorageEncryption();
  assert.equal(audit.byColumn["provider_connections.api_key"], 1);
  assert.equal(audit.byColumn["provider_connections.access_token"], 1);
  assert.equal(audit.byColumn["webhooks.secret"], 1);
  assert.equal(audit.insecureRows, 3);
  assert.ok(!JSON.stringify(audit).includes("sk-plaintext-secret"), "values are never surfaced");

  const readiness = buildStorageReadiness({ NODE_ENV: "development", HOST: "0.0.0.0" });
  assert.equal(readiness.status, "insecure_storage");
  assert.equal(readiness.encryptionRequired, true, "explicit non-loopback bind requires a key");
  assert.equal(readiness.bindHost, "0.0.0.0");
});

test("a column missing from the schema is reported as skipped, not as a crash", () => {
  const fake = {
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes("cloud_agent_credentials")) throw new Error("no such table");
        return [];
      },
    }),
  };
  const audit = auditStorageEncryption(fake);
  assert.deepEqual(audit.skipped, ["cloud_agent_credentials.api_key_encrypted"]);
  assert.equal(audit.insecureRows, 0);
});
