import { getDbInstance } from "./core";
import { decrypt, encryptSensitive } from "./encryption";

interface SecretRow {
  value?: string;
}

export function getPersistedSecret(key: string): string | null {
  try {
    const db = getDbInstance();
    const row = db
      .prepare("SELECT value FROM key_value WHERE namespace = 'secrets' AND key = ?")
      .get(key) as SecretRow | undefined;
    if (typeof row?.value !== "string") return null;
    const stored = JSON.parse(row.value);
    // #3: values written by persistSecret are encrypted (enc:v1:); decrypt() passes legacy
    // plaintext through unchanged, so old rows keep working.
    return typeof stored === "string" ? (decrypt(stored) ?? null) : (stored ?? null);
  } catch {
    return null;
  }
}

export function persistSecret(key: string, value: string): void {
  try {
    const db = getDbInstance();
    // #3: encrypt the secret at rest (fail-closed in exposed/production profiles). This store is
    // used e.g. by the Electron login flow to persist extracted provider credentials.
    const toStore = encryptSensitive(value) ?? value;
    db.prepare(
      "INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('secrets', ?, ?)"
    ).run(key, JSON.stringify(toStore));
  } catch {
    // Non-fatal: secrets still work for the current process if persistence fails.
  }
}
