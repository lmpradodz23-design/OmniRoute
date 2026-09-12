-- 174_compression_run_telemetry.sql
--
-- Promote `compression_run_telemetry` from a lazily-created runtime table to a real migration.
--
-- WHY: the table was only ever created by `ensureCompressionRunTelemetryTable()` in
-- src/lib/db/compressionRunTelemetry.ts, on demand, the first time compression telemetry
-- was recorded. Whether a database has it therefore depends on TIMING, not on the schema
-- version — exactly the divergence class of 169_model_capabilities. The v3.8.51
-- `check:install-upgrade` run reported it as a table "present only after upgrade"
-- (upgraded database: 132 tables, clean install: 131).
--
-- Creating it here makes both install paths converge deterministically.
-- `ensureCompressionRunTelemetryTable()` stays in place as an idempotent safety net;
-- tests/unit/db-install-upgrade-schema-parity.test.ts pins the two definitions against drift.
--
-- IF NOT EXISTS is required, not decorative: every database that ever recorded compression
-- telemetry already has this table, and this migration must be a no-op there.

CREATE TABLE IF NOT EXISTS compression_run_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  request_id TEXT,
  model TEXT,
  provider TEXT,
  source TEXT,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  ratio REAL,
  cost_delta REAL,
  output_styles TEXT,
  output_style_bypass TEXT,
  output_tokens INTEGER
);
