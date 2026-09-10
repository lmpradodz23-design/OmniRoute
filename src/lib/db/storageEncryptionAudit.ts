/**
 * storageEncryptionAudit — does the credential store actually hold plaintext? (finding #3
 * residual: "readiness must detect insecure storage").
 *
 * `encrypt()` is a passthrough when no key is configured, and the fail-closed gate only
 * covers exposed/production profiles, so a database can legitimately contain plaintext rows
 * (written in dev, or before a key was introduced). This scan counts, per sensitive column,
 * the non-empty values that do NOT carry the `enc:v1:` ciphertext prefix, so
 * `/api/monitoring/health` can report `insecure_storage` to a management caller instead of
 * assuming the key's presence means the data is protected.
 *
 * Values are never returned or logged — only counts.
 */
import { getDbInstance } from "./core";
import { isEncryptionEnabled, isStorageEncryptionRequired, looksEncrypted } from "./encryption";
import { isExposedBind, resolveBindHost } from "./deploymentProfile";

interface SensitiveColumnSet {
  table: string;
  columns: string[];
  /** Optional WHERE fragment restricting the scan (e.g. one key_value namespace). */
  where?: string;
}

/** Every column the credential writers encrypt (`encryptSensitive` call sites). */
export const SENSITIVE_COLUMNS: readonly SensitiveColumnSet[] = [
  {
    table: "provider_connections",
    columns: ["api_key", "access_token", "refresh_token", "id_token"],
  },
  { table: "api_keys", columns: ["key"] },
  { table: "webhooks", columns: ["secret"] },
  { table: "cloud_agent_credentials", columns: ["api_key_encrypted"] },
  { table: "key_value", columns: ["value"], where: "namespace = 'secrets'" },
];

type ScanDb = { prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] } };

export interface StorageEncryptionAudit {
  /** Non-empty sensitive values stored WITHOUT the ciphertext prefix. */
  insecureRows: number;
  /** `table.column` → plaintext count (only columns with at least one hit). */
  byColumn: Record<string, number>;
  /** `table.column` pairs that were scanned. */
  scanned: string[];
  /** `table.column` pairs that could not be scanned (table/column absent on this schema). */
  skipped: string[];
}

export function auditStorageEncryption(
  db: ScanDb = getDbInstance() as unknown as ScanDb
): StorageEncryptionAudit {
  const audit: StorageEncryptionAudit = { insecureRows: 0, byColumn: {}, scanned: [], skipped: [] };
  for (const { table, columns, where } of SENSITIVE_COLUMNS) {
    for (const column of columns) {
      const label = `${table}.${column}`;
      const filter = [`${column} IS NOT NULL`, `${column} != ''`, ...(where ? [where] : [])].join(
        " AND "
      );
      try {
        const rows = db
          .prepare(`SELECT ${column} AS v FROM ${table} WHERE ${filter}`)
          .all() as Array<{ v: unknown }>;
        const plaintext = rows.filter(
          (row) => typeof row.v === "string" && !looksEncrypted(row.v)
        ).length;
        audit.scanned.push(label);
        if (plaintext > 0) {
          audit.byColumn[label] = plaintext;
          audit.insecureRows += plaintext;
        }
      } catch {
        audit.skipped.push(label);
      }
    }
  }
  return audit;
}

export type StorageReadinessStatus = "ok" | "insecure_storage" | "encryption_disabled";

export interface StorageReadiness extends StorageEncryptionAudit {
  encryptionConfigured: boolean;
  encryptionRequired: boolean;
  bindHost: string;
  bindHostExplicit: boolean;
  exposed: boolean;
  status: StorageReadinessStatus;
}

/**
 * The `storage` section of the management health view. `insecure_storage` = plaintext
 * sensitive rows exist (regardless of whether a key is configured now);
 * `encryption_disabled` = no key and no plaintext yet (the next credential write would be
 * plaintext); `ok` = key configured and every sensitive value is ciphertext.
 */
export function buildStorageReadiness(
  env: NodeJS.ProcessEnv = process.env,
  db?: ScanDb
): StorageReadiness {
  const audit = auditStorageEncryption(db);
  const encryptionConfigured = isEncryptionEnabled();
  const bind = resolveBindHost(env);
  const status: StorageReadinessStatus =
    audit.insecureRows > 0
      ? "insecure_storage"
      : encryptionConfigured
        ? "ok"
        : "encryption_disabled";
  return {
    ...audit,
    encryptionConfigured,
    encryptionRequired: isStorageEncryptionRequired(env),
    bindHost: bind.host,
    bindHostExplicit: bind.explicit,
    exposed: isExposedBind(env),
    status,
  };
}
