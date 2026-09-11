/**
 * Bounded retry for SQLITE_BUSY on the normal write path (R-3).
 *
 * The connection already waits `busy_timeout` (2 s in core.ts) before SQLite gives up,
 * but several other processes legitimately open the same file — the Electron host's
 * inspection connection, `VACUUM INTO` snapshots, backups, a second OmniRoute instance
 * — and a checkpointing/closing WAL connection briefly holds it EXCLUSIVE. Before this
 * helper the only retry lived in the startup probe; a write that met the lock past the
 * timeout threw straight into the request. The budget below is deliberately small
 * (25+50+100+200 ms on top of each attempt's busy_timeout) so a genuinely stuck lock
 * still surfaces quickly instead of parking the event loop.
 *
 * Retries only apply OUTSIDE an open transaction: inside one the statement may be part
 * of already-applied work, so the caller's transaction decides.
 */

export const SQLITE_BUSY_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200];

/** SQLITE_BUSY / "database is locked" across better-sqlite3, node:sqlite and message-only errors. */
export function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, errcode, message } = error as {
    code?: unknown;
    errcode?: unknown;
    message?: unknown;
  };
  if (typeof code === "string" && code.startsWith("SQLITE_BUSY")) return true;
  if (typeof errcode === "number" && (errcode & 0xff) === 5) return true;
  return (
    typeof message === "string" && /database(?: table| schema)? is (?:locked|busy)/i.test(message)
  );
}

export function syncSleep(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Atomics.wait is unavailable on some restricted runtimes: busy-wait the short delay.
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }
}

let lastWarnAt = 0;

/**
 * Runs `fn`, retrying it after each SQLITE_BUSY while `canRetry()` holds (typically "no
 * transaction is open on this connection"). Any other error, or exhaustion of the
 * budget, rethrows the last error untouched.
 */
export function runWithBusyRetry<T>(
  fn: () => T,
  canRetry: () => boolean,
  delays: readonly number[] = SQLITE_BUSY_RETRY_DELAYS_MS
): T {
  let attempt = 0;
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= delays.length || !canRetry()) throw error;
      const delay = delays[attempt];
      attempt += 1;
      const now = Date.now();
      if (now - lastWarnAt > 10_000) {
        lastWarnAt = now;
        console.warn(
          `[DB] SQLITE_BUSY on write; retrying in ${delay} ms (attempt ${attempt}/${delays.length}). ` +
            `Another process holds the database lock.`
        );
      }
      syncSleep(delay);
    }
  }
}
