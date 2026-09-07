-- 174_converge_chatgpt_web_cleanroom.sql
--
-- R3-A convergence migration. DERIVED from the combined net effect of the release
-- migrations 168 (retire chatgpt-web/cgpt-web) and 171 (restore the clean-room
-- canonical `chatgpt-web`) WITHOUT transplanting them as separate numbered files.
-- Produces the final clean-room state directly and converges from BOTH:
--   (P1) a fresh baseline DB at level 163 (never had 168/171): creates the final
--        triggers and fail-closed tombstones.
--   (P2) an existing release DB at level 173 (168+171 already applied): the trigger
--        DROP/CREATE re-establishes the identical final state and the null-safe
--        tombstone predicates avoid any row churn -> effectively a no-op.
--
-- Properties (ADR-002 §5): additive (rows kept for audit, only disabled fail-closed),
-- transactional (runner wraps each migration file in one transaction), idempotent
-- (IF NOT EXISTS + null-safe WHEN guards), non-destructive (no DROP of data, no reset,
-- no renumber, no downgrade). The canonical `chatgpt-web` is NOT auto-retired: it stays
-- disabled until an operator supplies the new storage-state credential. `cgpt-web`
-- (legacy alias) remains permanently retired and is not an alias of the clean-room id.

-- (1) Fail-closed data tombstone for existing chatgpt-web AND cgpt-web rows.
--     Null-safe churn guards keep re-runs inert (derived from 168).
UPDATE exclusive_connection_leases
SET state = 'INVALIDATED',
    ended_at = datetime('now'),
    end_reason = 'CONNECTION_INELIGIBLE'
WHERE state = 'ACTIVE'
  AND (
    lower(trim(provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
      IN ('chatgpt-web', 'cgpt-web')
    OR connection_id IN (
      SELECT id
      FROM provider_connections
      WHERE lower(trim(provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
        IN ('chatgpt-web', 'cgpt-web')
    )
  );

UPDATE provider_connections
SET is_active = 0,
    test_status = 'unavailable',
    error_code = 'PROVIDER_REMOVED',
    last_error = 'Provider integration retired from OmniRoute v3.8.51',
    last_error_type = 'provider_removed',
    last_error_source = 'migration:retire-chatgpt-web',
    last_error_at = datetime('now'),
    updated_at = datetime('now')
WHERE lower(trim(provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
    IN ('chatgpt-web', 'cgpt-web')
  AND (
    is_active IS NOT 0
    OR test_status IS NOT 'unavailable'
    OR error_code IS NOT 'PROVIDER_REMOVED'
    OR last_error IS NOT 'Provider integration retired from OmniRoute v3.8.51'
    OR last_error_type IS NOT 'provider_removed'
    OR last_error_source IS NOT 'migration:retire-chatgpt-web'
    OR last_error_at IS NULL
  );

-- (2) Durable identity-preservation triggers for BOTH ids (derived from 168; 171 keeps them).
-- Once a connection id belongs to a retired provider, imports and internal
-- writers must not repurpose that same audited identity as another provider.
-- Retired-to-retired normalization remains allowed and is re-tombstoned by the
-- AFTER UPDATE trigger above.
CREATE TRIGGER IF NOT EXISTS provider_connections_preserve_chatgpt_web_identity_insert
BEFORE INSERT ON provider_connections
WHEN EXISTS (
    SELECT 1
    FROM provider_connections
    WHERE id = NEW.id
      AND lower(trim(provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
        IN ('chatgpt-web', 'cgpt-web')
  )
  AND lower(trim(NEW.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
    NOT IN ('chatgpt-web', 'cgpt-web')
BEGIN
  SELECT RAISE(ABORT, 'Retired provider connection identity cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS provider_connections_preserve_chatgpt_web_identity_update
BEFORE UPDATE OF provider ON provider_connections
WHEN lower(trim(OLD.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
    IN ('chatgpt-web', 'cgpt-web')
  AND lower(trim(NEW.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
    NOT IN ('chatgpt-web', 'cgpt-web')
BEGIN
  SELECT RAISE(ABORT, 'Retired provider connection identity cannot be changed');
END;

-- (3) Final retire triggers scoped to `cgpt-web` ONLY. DROP+CREATE normalizes a fresh
--     baseline and an existing release DB to one identical state (derived from 171).
DROP TRIGGER IF EXISTS provider_connections_retire_chatgpt_web_insert;
DROP TRIGGER IF EXISTS provider_connections_retire_chatgpt_web_update;
DROP TRIGGER IF EXISTS exclusive_connection_leases_retire_chatgpt_web_insert;
DROP TRIGGER IF EXISTS exclusive_connection_leases_retire_chatgpt_web_update;

CREATE TRIGGER provider_connections_retire_chatgpt_web_insert
AFTER INSERT ON provider_connections
WHEN lower(trim(NEW.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
    = 'cgpt-web'
BEGIN
  UPDATE provider_connections
  SET is_active = 0,
      test_status = 'unavailable',
      error_code = 'PROVIDER_REMOVED',
      last_error = 'Provider integration retired from OmniRoute v3.8.51',
      last_error_type = 'provider_removed',
      last_error_source = 'migration:retire-chatgpt-web',
      last_error_at = datetime('now'),
      updated_at = datetime('now')
  WHERE id = NEW.id
    AND (
      is_active IS NOT 0
      OR test_status IS NOT 'unavailable'
      OR error_code IS NOT 'PROVIDER_REMOVED'
      OR last_error IS NOT 'Provider integration retired from OmniRoute v3.8.51'
      OR last_error_type IS NOT 'provider_removed'
      OR last_error_source IS NOT 'migration:retire-chatgpt-web'
      OR last_error_at IS NULL
    );

  UPDATE exclusive_connection_leases
  SET state = 'INVALIDATED',
      ended_at = datetime('now'),
      end_reason = 'CONNECTION_INELIGIBLE'
  WHERE state = 'ACTIVE'
    AND connection_id = NEW.id;
END;

CREATE TRIGGER provider_connections_retire_chatgpt_web_update
AFTER UPDATE OF provider, is_active, test_status, error_code, last_error,
  last_error_type, last_error_source, last_error_at ON provider_connections
WHEN lower(trim(NEW.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
    = 'cgpt-web'
BEGIN
  UPDATE provider_connections
  SET is_active = 0,
      test_status = 'unavailable',
      error_code = 'PROVIDER_REMOVED',
      last_error = 'Provider integration retired from OmniRoute v3.8.51',
      last_error_type = 'provider_removed',
      last_error_source = 'migration:retire-chatgpt-web',
      last_error_at = datetime('now'),
      updated_at = datetime('now')
  WHERE id = NEW.id
    AND (
      is_active IS NOT 0
      OR test_status IS NOT 'unavailable'
      OR error_code IS NOT 'PROVIDER_REMOVED'
      OR last_error IS NOT 'Provider integration retired from OmniRoute v3.8.51'
      OR last_error_type IS NOT 'provider_removed'
      OR last_error_source IS NOT 'migration:retire-chatgpt-web'
      OR last_error_at IS NULL
    );

  UPDATE exclusive_connection_leases
  SET state = 'INVALIDATED',
      ended_at = datetime('now'),
      end_reason = 'CONNECTION_INELIGIBLE'
  WHERE state = 'ACTIVE'
    AND connection_id = NEW.id;
END;

CREATE TRIGGER exclusive_connection_leases_retire_chatgpt_web_insert
AFTER INSERT ON exclusive_connection_leases
WHEN NEW.state = 'ACTIVE'
  AND (
    lower(trim(NEW.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
      = 'cgpt-web'
    OR EXISTS (
      SELECT 1
      FROM provider_connections
      WHERE id = NEW.connection_id
        AND lower(trim(provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
          = 'cgpt-web'
    )
  )
BEGIN
  UPDATE exclusive_connection_leases
  SET state = 'INVALIDATED',
      ended_at = datetime('now'),
      end_reason = 'CONNECTION_INELIGIBLE'
  WHERE id = NEW.id
    AND state = 'ACTIVE';
END;

CREATE TRIGGER exclusive_connection_leases_retire_chatgpt_web_update
AFTER UPDATE OF provider, connection_id, state ON exclusive_connection_leases
WHEN NEW.state = 'ACTIVE'
  AND (
    lower(trim(NEW.provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
      = 'cgpt-web'
    OR EXISTS (
      SELECT 1
      FROM provider_connections
      WHERE id = NEW.connection_id
        AND lower(trim(provider, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
          = 'cgpt-web'
    )
  )
BEGIN
  UPDATE exclusive_connection_leases
  SET state = 'INVALIDATED',
      ended_at = datetime('now'),
      end_reason = 'CONNECTION_INELIGIBLE'
  WHERE id = NEW.id
    AND state = 'ACTIVE';
END;
