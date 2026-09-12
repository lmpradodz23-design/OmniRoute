/**
 * At-rest encryption sweeps run once at database init (core.ts::getDbInstance):
 *  - #8 webhook HMAC secrets still stored in plaintext in `webhooks.secret`;
 *  - #7 API keys still stored in plaintext in `api_keys.key`.
 *
 * Both are idempotent (rows already `enc:v1:` are skipped), transactional, and no-ops
 * without an encryption key. Only a genuine ciphertext is ever written back — a
 * passthrough (plaintext) result from encrypt() is never re-stored as if migrated.
 *
 * Leaf module: the adapter is passed in explicitly and nothing from ./core is imported,
 * so core.ts can run these sweeps without the core → webhooks/apiKeys → core cycle.
 * webhooks.ts / apiKeys.ts keep their `encryptExisting*()` wrappers over getDbInstance().
 */
import type { SqliteAdapter } from "./adapters/types";
import { encrypt, isEncryptionEnabled } from "./encryption";

/** Returns the number of webhook secrets migrated to ciphertext. */
export function encryptWebhookSecretsAtRest(db: SqliteAdapter): number {
  if (!isEncryptionEnabled()) return 0;
  const rows = db
    .prepare(
      "SELECT id, secret FROM webhooks WHERE secret IS NOT NULL AND secret <> '' AND secret NOT LIKE 'enc:v1:%'"
    )
    .all() as Array<{ id: string; secret: string }>;
  if (rows.length === 0) return 0;

  const update = db.prepare("UPDATE webhooks SET secret = ? WHERE id = ?");
  let migrated = 0;
  const runAll = db.transaction(() => {
    for (const row of rows) {
      const enc = encrypt(row.secret);
      // Only write back a genuine ciphertext — never re-store plaintext (passthrough) as if migrated.
      if (typeof enc === "string" && enc.startsWith("enc:v1:")) {
        update.run(enc, row.id);
        migrated++;
      }
    }
  });
  runAll();
  return migrated;
}

/**
 * Returns the number of API keys migrated to ciphertext. Validation is by key_hash, so
 * this changes only the at-rest value; the key keeps working.
 */
export function encryptApiKeysAtRest(db: SqliteAdapter): number {
  if (!isEncryptionEnabled()) return 0;
  const rows = db
    .prepare(
      "SELECT id, key FROM api_keys WHERE key IS NOT NULL AND key <> '' AND key NOT LIKE 'enc:v1:%'"
    )
    .all() as Array<{ id: string; key: string }>;
  if (rows.length === 0) return 0;

  const update = db.prepare("UPDATE api_keys SET key = ? WHERE id = ?");
  let migrated = 0;
  const runAll = db.transaction(() => {
    for (const row of rows) {
      const enc = encrypt(row.key);
      if (typeof enc === "string" && enc.startsWith("enc:v1:")) {
        update.run(enc, row.id);
        migrated++;
      }
    }
  });
  runAll();
  return migrated;
}
