/**
 * At-rest storage fields of an api_keys row: `key` (ciphertext when encryption is
 * configured), `key_hash` (SHA-256 of the plaintext — the lookup column used by
 * validateApiKey/getApiKeyMetadata) and `key_prefix`.
 *
 * Leaf module (only ./encryption): the api_keys module, the legacy db.json startup
 * migration (core.ts) and the dashboard JSON import all derive these columns from here,
 * so core.ts never has to import apiKeys.ts (which imports core.ts) for a hashing helper.
 */
import { createHash } from "crypto";
import { decrypt, encryptSensitive } from "../encryption";

function hashKeySync(key: string): string {
  if (!key || typeof key !== "string") return "";
  // CodeQL: This is intentionally SHA-256, NOT password hashing. API keys are
  // high-entropy random tokens (not user-chosen passwords) and need fast O(1)
  // comparison for per-request validation. bcrypt/scrypt would add ~100ms per
  // request, which is unacceptable for an API proxy.
  // lgtm[js/insufficient-password-hash]
  return createHash("sha256").update(key).digest("hex"); // nosemgrep: insufficient-password-hash
}

export async function hashKey(key: string): Promise<string> {
  return hashKeySync(key);
}

/**
 * Storage columns for an api_keys row written outside createApiKey — the legacy db.json
 * startup migration and the dashboard JSON import. Validation and metadata lookups
 * resolve rows by `key_hash` only, so a row inserted with just `key` is invisible to
 * auth: the imported key authenticates nothing and the dashboard cannot describe it.
 * Same at-rest rule as createApiKey (#7): the plaintext is never stored when encryption
 * is configured. An already-encrypted value (`enc:v1:`, e.g. re-imported from an export
 * of an encrypted database) is decrypted for hashing; if that fails the row keeps the
 * value verbatim and no hash — it cannot authenticate, but the import does not abort.
 */
export function deriveApiKeyStorageFields(value: unknown): {
  key: string | null;
  keyHash: string | null;
  keyPrefix: string | null;
} {
  if (typeof value !== "string" || value.length === 0) {
    return { key: null, keyHash: null, keyPrefix: null };
  }
  let plaintext: string | null | undefined = value;
  if (value.startsWith("enc:v1:")) {
    try {
      plaintext = decrypt(value);
    } catch {
      plaintext = null;
    }
    // Passthrough mode (no encryption key configured) hands the ciphertext back untouched.
    if (typeof plaintext === "string" && plaintext.startsWith("enc:v1:")) plaintext = null;
  }
  if (!plaintext) return { key: value, keyHash: null, keyPrefix: null };
  return {
    key: encryptSensitive(plaintext) ?? plaintext,
    keyHash: hashKeySync(plaintext),
    keyPrefix: plaintext.slice(0, 12),
  };
}
