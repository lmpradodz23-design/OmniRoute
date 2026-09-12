-- 176_buzz_outbox_retry_schedule.sql
--
-- Retry scheduling for the Buzz outbox (audit A-H3): a publish that the relay rejected or
-- that timed out is retried with exponential backoff + jitter until OUTBOX_MAX_ATTEMPTS
-- (src/lib/db/buzzBridge.ts). Additive and non-destructive: one nullable column on the
-- table created by 175. NULL = eligible immediately (rows written before this migration).
ALTER TABLE buzz_outbox ADD COLUMN next_attempt_at TEXT;
