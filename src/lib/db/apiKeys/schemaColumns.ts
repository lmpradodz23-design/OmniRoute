/**
 * Lazily-added api_keys fallback columns (`ensureApiKeysColumns`).
 *
 * Columns listed in API_KEY_COLUMN_FALLBACKS (key_hash, no_log, revoked_at, ...) are added
 * on first use rather than by a migration. The check is memoized per process and reset
 * together with the prepared-statement cache when the database connection is replaced.
 *
 * Leaf module (only ./apiKeyColumnFallbacks): the legacy db.json importer in core.ts
 * needs the same guarantee before its INSERT without importing apiKeys.ts (a cycle).
 */
import { API_KEY_COLUMN_FALLBACKS } from "../apiKeyColumnFallbacks";

// Schema check memoization - only run once
let _schemaChecked = false;

/** The slice of a database handle the schema check needs — satisfied by every adapter. */
interface ApiKeysSchemaDb {
  prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
  exec: (sql: string) => void;
}

function ensureApiKeyColumn(
  db: ApiKeysSchemaDb,
  columnNames: Set<string>,
  column: (typeof API_KEY_COLUMN_FALLBACKS)[number]
): void {
  if (columnNames.has(column.name)) return;
  db.exec(`ALTER TABLE api_keys ADD COLUMN ${column.definition}`);
  console.log(`[DB] Added api_keys.${column.name} column`);
}

/**
 * Adds any api_keys column this module relies on that the physical schema still lacks
 * (fallback columns such as key_hash are added lazily here, not by a migration). Callers
 * that write api_keys rows outside this module — the legacy JSON importers — must run it
 * before preparing their INSERT, or a fresh database rejects the key_hash column.
 */
export function ensureApiKeysColumns(db: ApiKeysSchemaDb) {
  if (_schemaChecked) return;

  try {
    const columns = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name?: unknown }>;
    const columnNames = new Set(columns.map((column) => String(column.name ?? "")));
    for (const column of API_KEY_COLUMN_FALLBACKS) {
      ensureApiKeyColumn(db, columnNames, column);
    }
    _schemaChecked = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[DB] Failed to verify api_keys schema:", message);
  }
}

/** Forget the memoized schema check — a new connection must be verified again. */
export function resetApiKeysSchemaCheck(): void {
  _schemaChecked = false;
}
