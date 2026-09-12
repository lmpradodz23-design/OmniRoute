/**
 * Legacy db.json → SQLite startup migration (core.ts::migrateFromJson): the api_keys rows.
 *
 * key_hash/key_prefix are how validateApiKey/getApiKeyMetadata find a row — writing only
 * `key` produced keys that never authenticated after the startup migration. Both are
 * lazily-added fallback columns: they are ensured before the INSERT is prepared.
 *
 * Runs inside the caller's `db.transaction(...)`. Depends only on leaf api-key modules
 * (storage fields, schema columns, model access mode) so core.ts never imports apiKeys.ts.
 */
import type { SqliteAdapter } from "../adapters/types";
import { parseModelAccessMode } from "../apiKeys/modelAccessMode";
import { ensureApiKeysColumns } from "../apiKeys/schemaColumns";
import { deriveApiKeyStorageFields } from "../apiKeys/storageFields";

/** One `apiKeys[]` entry of the legacy db.json (untyped JSON — every field is unknown). */
type LegacyJsonApiKey = {
  id?: unknown;
  name?: unknown;
  key?: unknown;
  machineId?: unknown;
  modelAccessMode?: unknown;
  allowedModels?: unknown;
  noLog?: unknown;
  createdAt?: unknown;
};

export function importLegacyJsonApiKeys(db: SqliteAdapter, apiKeys: LegacyJsonApiKey[]): void {
  ensureApiKeysColumns(db);
  const insertKey = db.prepare(`
        INSERT OR REPLACE INTO api_keys (id, name, key, key_hash, key_prefix, machine_id, model_access_mode, allowed_models, no_log, created_at)
        VALUES (@id, @name, @key, @keyHash, @keyPrefix, @machineId, @modelAccessMode, @allowedModels, @noLog, @createdAt)
      `);
  for (const apiKey of apiKeys) {
    const storage = deriveApiKeyStorageFields(apiKey.key);
    insertKey.run({
      id: apiKey.id,
      name: apiKey.name,
      key: storage.key,
      keyHash: storage.keyHash,
      keyPrefix: storage.keyPrefix,
      machineId: apiKey.machineId || null,
      modelAccessMode: parseModelAccessMode(apiKey.modelAccessMode, apiKey.allowedModels),
      allowedModels: JSON.stringify(apiKey.allowedModels || []),
      noLog: apiKey.noLog ? 1 : 0,
      createdAt: apiKey.createdAt || new Date().toISOString(),
    });
  }
}
