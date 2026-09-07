-- 175_loop_engine_and_buzz_bridge.sql
--
-- Estado durável dos módulos agentic da Fase 1 (Loop Engine + Buzz Bridge). Aditiva,
-- idempotente (IF NOT EXISTS) e não-destrutiva: só cria tabelas/índices novos, não toca
-- nada existente. O OmniRoute permanece a fonte de verdade de runs/steps/aprovações; a
-- ponte Buzz (outbox/inbox) é idempotente por design. Ambos os módulos ficam atrás das
-- flags LOOP_ENGINE_ENABLED / BUZZ_HUB_ENABLED (OFF por padrão).

-- ── Loop Engine ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loop_runs (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  task_id TEXT,
  sequence_number INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loop_runs_status ON loop_runs (status);
CREATE INDEX IF NOT EXISTS idx_loop_runs_correlation ON loop_runs (correlation_id);

CREATE TABLE IF NOT EXISTS loop_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  proposed_effect_json TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loop_steps_run ON loop_steps (run_id, idx);

-- ── Buzz Bridge (ponte idempotente OmniRoute ↔ relay Nostr) ──
CREATE TABLE IF NOT EXISTS buzz_outbox (
  id TEXT PRIMARY KEY,               -- = event.id (dedup)
  correlation_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  task_id TEXT,
  run_id TEXT,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buzz_outbox_status ON buzz_outbox (status, sequence_number);

CREATE TABLE IF NOT EXISTS buzz_inbox (
  event_id TEXT PRIMARY KEY,          -- dedup de entrada
  correlation_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buzz_inbox_status ON buzz_inbox (status);
