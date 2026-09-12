/**
 * Final-state probe for plain-SQL migrations (R-4 / A-6).
 *
 * When applying a migration fails with "duplicate column name", that error only proves
 * ONE column pre-existed. The runner tolerates it (marker-only) solely when everything
 * the file creates — every `ALTER TABLE ... ADD COLUMN` and every `CREATE TABLE` /
 * `CREATE INDEX` — is already present; otherwise the migration is genuinely partial and
 * the failure is reported with the list of objects still missing.
 */
import fs from "fs";
import type { SqliteAdapter } from "../adapters/types";
import { hasColumn } from "./schemaState";

const ALTER_ADD_COLUMN_RE =
  /ALTER\s+TABLE\s+["'`[]?([A-Za-z0-9_]+)["'`\]]?\s+ADD\s+(?:COLUMN\s+)?["'`[]?([A-Za-z0-9_]+)["'`\]]?/gi;

/** Every `table.column` a plain-SQL migration adds via ALTER TABLE ... ADD COLUMN. */
export function expectedAddedColumns(sql: string): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  for (const match of sql.matchAll(ALTER_ADD_COLUMN_RE)) {
    out.push({ table: match[1], column: match[2] });
  }
  return out;
}

const CREATE_OBJECT_RE =
  /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z0-9_]+)["'`\]]?/gi;

/** Every table/index a plain-SQL migration creates — the rest of its final state (A-6). */
export function expectedCreatedObjects(
  sql: string
): Array<{ type: "table" | "index"; name: string }> {
  const out: Array<{ type: "table" | "index"; name: string }> = [];
  for (const match of sql.matchAll(CREATE_OBJECT_RE)) {
    out.push({ type: match[1].toLowerCase() as "table" | "index", name: match[2] });
  }
  return out;
}

function hasSchemaObject(db: SqliteAdapter, type: "table" | "index", name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
    .get(type, name) as { name: string } | undefined;
  return Boolean(row);
}

/**
 * R-4 final-state probe behind the "duplicate column name" tolerance: the columns the
 * file still has to add. Empty means the whole file is already applied; a non-empty list
 * means the migration is genuinely partial. Handler-managed versions (032/041/042) are
 * judged by the idempotency probe (`isSchemaAlreadyApplied`, injected by the runner so this
 * module stays free of the runner's own imports); a file that adds no column at all is
 * unverifiable and is reported as such (fail closed).
 */
export function missingAddedColumns(
  db: SqliteAdapter,
  migration: { version: string; name: string; path: string },
  isSchemaAlreadyApplied: (
    db: SqliteAdapter,
    migration: { version: string; name: string }
  ) => boolean
): string[] {
  if (
    migration.version === "032" ||
    (migration.version === "041" && migration.name === "compression_receipts") ||
    migration.version === "042"
  ) {
    return isSchemaAlreadyApplied(db, migration) ? [] : ["(handler-managed schema incomplete)"];
  }
  let sql: string;
  try {
    sql = fs.readFileSync(migration.path, "utf-8");
  } catch {
    return ["(migration file unreadable)"];
  }
  const expected = expectedAddedColumns(sql);
  if (expected.length === 0) return ["(no ADD COLUMN statement found to verify)"];
  const missing = expected
    .filter(({ table, column }) => !hasColumn(db, table, column))
    .map(({ table, column }) => `${table}.${column}`);
  // A-6: the columns are not the whole final state. A file whose first ALTER collided
  // while its CREATE INDEX / CREATE TABLE never ran is still partial — probe those too.
  for (const { type, name } of expectedCreatedObjects(sql)) {
    if (!hasSchemaObject(db, type, name)) missing.push(`${type}:${name}`);
  }
  return missing;
}
