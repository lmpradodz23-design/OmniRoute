/**
 * Poll the auth-exempt health ping until the server answers again (U7/J13).
 *
 * Used after "Restart" in the dashboard: a fixed-delay reload landed on the browser's
 * connection-refused page whenever the restart took longer than the timer (migrations,
 * slow disks, Electron respawn). Polling the ping makes the reload land on a live server.
 */

export interface WaitForServerReadyOptions {
  /** Health endpoint to poll. Defaults to the lightweight, auth-exempt ping. */
  url?: string;
  /** Delay between polls in milliseconds. */
  intervalMs?: number;
  /** Total budget in milliseconds before giving up. */
  timeoutMs?: number;
  /** Injectable fetch (tests). Defaults to the global fetch. */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_URL = "/api/health/ping";
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve `true` as soon as the health endpoint answers 2xx, `false` once the budget is
 * exhausted. Never throws: network errors mean "not up yet".
 */
export async function waitForServerReady(
  options: WaitForServerReadyOptions = {}
): Promise<boolean> {
  const url = options.url ?? DEFAULT_URL;
  const intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const res = await fetchFn(url, { cache: "no-store", credentials: "same-origin" });
      if (res.ok) return true;
    } catch {
      // Connection refused / reset while the server is restarting — keep polling.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(intervalMs, remaining));
  }
}

export interface WaitForServerRestartOptions extends WaitForServerReadyOptions {
  /** How long to wait for the OLD process to stop answering before polling for readiness. */
  downTimeoutMs?: number;
}

const DEFAULT_DOWN_TIMEOUT_MS = 10_000;

/**
 * After POST /api/restart the old process keeps answering for a moment (SIGTERM is sent
 * ~500 ms later and the drain runs first), so polling for "ready" right away would reload
 * onto the dying server. Wait until the ping stops answering (bounded), then wait for it
 * to answer again.
 */
export async function waitForServerRestart(
  options: WaitForServerRestartOptions = {}
): Promise<boolean> {
  const url = options.url ?? DEFAULT_URL;
  const intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const downTimeoutMs = Math.max(0, options.downTimeoutMs ?? DEFAULT_DOWN_TIMEOUT_MS);
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  const downDeadline = Date.now() + downTimeoutMs;

  while (Date.now() < downDeadline) {
    let stillUp = false;
    try {
      const res = await fetchFn(url, { cache: "no-store", credentials: "same-origin" });
      stillUp = res.ok;
    } catch {
      stillUp = false;
    }
    if (!stillUp) break;
    await sleep(Math.min(intervalMs, Math.max(1, downDeadline - Date.now())));
  }

  return waitForServerReady({ ...options, url, intervalMs, fetchFn });
}
