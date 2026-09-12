/**
 * Local-CLI no-auth provider availability for the `/v1/models` catalog (C-05).
 *
 * `NOAUTH_PROVIDERS` entries marked `isLocalCli: true` (`devin-cli-agentic`,
 * `auggie`, `zcode`, `codex-app-server`) carry no credential, so the catalog
 * used to treat them exactly like the free/web zero-config providers (#2798):
 * listed on every instance unless `settings.blockedProviders` disables them.
 * Unlike opencode/duckduckgo, though, they can only serve a request when the
 * local runtime they drive exists on THIS machine — a binary on disk / PATH or
 * a reachable `codex app-server` URL + capability token. On a fresh instance
 * without those CLIs the catalog advertised ~250 rows that could only fail at
 * request time.
 *
 * Each probe mirrors the discovery its executor performs (same env overrides,
 * same known paths, same PATH fallback), so "listed" and "routable" agree:
 *   - auggie            → open-sse/executors/auggie.ts::resolveAuggieBin (mirrored,
 *                         parity test in tests/unit/c05-v1-models-local-cli-availability.test.ts)
 *   - devin-cli-agentic → open-sse/executors/devin-cli-agentic.ts::resolveDevinBin
 *                         + buildDevinChildEnv's DEVIN_AGENTIC_HOME invariant (mirrored, parity test)
 *   - zcode             → open-sse/executors/zcode.ts::defaultCommand (mirrored)
 *   - codex-app-server  → open-sse/executors/codex/appServerConfig.ts::
 *                         resolveAppServerConfig (reused — a leaf module with no
 *                         executor-tree cost; connection rows + env)
 * Executor modules themselves are never imported here: evaluating the executor
 * tree is a multi-second synchronous stretch on a cold process and would pin the
 * event loop inside the catalog build (#9147 guard).
 *
 * Binary probes spawn `where.exe` / `command -v` (≤3s, see cliRuntime.ts), so
 * their verdict is memoized for LOCAL_CLI_AVAILABILITY_TTL_MS. A probe timeout
 * is NOT a verdict (#10710): it fails open (provider kept) and is not cached, so
 * a starved probe never hides an installed CLI. The app-server probe is pure
 * (env + provider rows) and evaluated on every build.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NOAUTH_PROVIDERS } from "@/shared/constants/providers";
import { getLookupEnv, locateCommand } from "@/shared/services/cliRuntime";

export const LOCAL_CLI_AVAILABILITY_TTL_MS = 60_000;

type NoAuthProviderDefinition = { id: string; alias?: string; isLocalCli?: boolean };

/** Ids (and aliases) of every no-auth provider that drives a local CLI / app-server. */
export const LOCAL_CLI_NOAUTH_PROVIDERS: ReadonlyArray<{ id: string; alias: string | null }> =
  Object.values(NOAUTH_PROVIDERS as Record<string, NoAuthProviderDefinition>)
    .filter((provider) => provider.isLocalCli === true)
    .map((provider) => ({
      id: provider.id,
      alias: typeof provider.alias === "string" ? provider.alias : null,
    }));

export type LocalCliAvailability = {
  available: boolean;
  /** Human-readable reason, stable for tests/diagnostics (e.g. "binary_not_found"). */
  reason: string;
};

type ProbeVerdict = LocalCliAvailability & {
  /** false when the probe could not decide (timeout) — never cached, fails open. */
  definitive: boolean;
};

export type LocalCliProbeContext = {
  /** Active provider connections of this instance (any provider). */
  connections: ReadonlyArray<{ provider?: unknown; providerSpecificData?: unknown }>;
};

type LookupEnv = Record<string, string | undefined>;

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate a command the way the executor will spawn it: an explicit path is
 * checked on disk, a bare name is resolved through PATH (cliRuntime's lookup
 * env, which includes CLI_EXTRA_PATHS and the login-shell PATH on macOS).
 */
async function probeCommand(command: string, env: LookupEnv): Promise<ProbeVerdict> {
  const located = await locateCommand(command, env);
  if (located.installed) {
    return { available: true, reason: "binary_found", definitive: true };
  }
  if (located.reason === "timeout") {
    return { available: true, reason: "probe_timeout", definitive: false };
  }
  return { available: false, reason: `binary_${located.reason || "not_found"}`, definitive: true };
}

/**
 * Mirror of open-sse/executors/auggie.ts::resolveAuggieBin. Deliberately NOT
 * imported from the executor: loading any executor module drags in the whole
 * executor tree (base.ts, registries) and its module evaluation is a multi-second
 * synchronous stretch on a cold process — measured 1.7s of event-loop pinning
 * inside the catalog build (tests/unit/9147-catalog-eventloop-yield.test.ts).
 * Parity with the executor is locked by the C-05 unit test.
 */
export async function resolveAuggieBinForProbe(): Promise<string> {
  const envBin = (process.env.AUGGIE_BIN || process.env.CLI_AUGGIE_BIN || "").trim();
  if (envBin) return envBin;

  const isWin = process.platform === "win32";
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winPath = path.join(localAppData, "auggie", "bin", "auggie.exe");
    if (await pathExists(winPath)) return winPath;
  }

  const home = os.homedir();
  for (const candidate of [
    path.join(home, ".local", "share", "auggie", "bin", "auggie"),
    path.join(home, ".auggie", "bin", "auggie"),
  ]) {
    if (await pathExists(candidate)) return candidate;
  }
  return isWin ? "auggie.cmd" : "auggie";
}

async function probeAuggie(env: LookupEnv): Promise<ProbeVerdict> {
  return probeCommand(await resolveAuggieBinForProbe(), env);
}

/**
 * Mirror of the DEVIN_AGENTIC_HOME invariant enforced by
 * open-sse/executors/devin-cli-agentic.ts::buildDevinChildEnv (isIsolatedHome):
 * the executor refuses every turn unless the home is an absolute path inside the
 * bridge sandbox. Same no-executor-import rationale as resolveAuggieBinForProbe;
 * parity is locked by the C-05 unit test.
 */
export function isDevinAgenticHomeUsable(home: string | undefined): boolean {
  const value = home?.trim() || "";
  if (!value || !path.isAbsolute(value)) return false;
  return value === "/home/bridge" || value.includes("/.sandbox/");
}

/** Mirror of open-sse/executors/devin-cli-agentic.ts::resolveDevinBin (not exported). */
async function resolveDevinBin(): Promise<string> {
  const envBin = process.env.CLI_DEVIN_AGENTIC_BIN?.trim() || process.env.CLI_DEVIN_BIN?.trim();
  if (envBin) return envBin;

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winPath = path.join(localAppData, "devin", "cli", "bin", "devin.exe");
    return (await pathExists(winPath)) ? winPath : "devin.exe";
  }

  for (const candidate of [
    path.join(os.homedir(), ".local", "share", "devin", "bin", "devin"),
    path.join(os.homedir(), ".devin", "bin", "devin"),
  ]) {
    if (await pathExists(candidate)) return candidate;
  }
  return "devin";
}

async function probeDevinAgentic(env: LookupEnv): Promise<ProbeVerdict> {
  if (!isDevinAgenticHomeUsable(process.env.DEVIN_AGENTIC_HOME)) {
    return { available: false, reason: "devin_agentic_home_unset", definitive: true };
  }
  return probeCommand(await resolveDevinBin(), env);
}

/** Mirror of open-sse/executors/zcode.ts::defaultCommand (not exported). */
async function probeZcode(env: LookupEnv): Promise<ProbeVerdict> {
  const runtimeRoot =
    process.env.ZCODE_SERVER_RUNTIME_ROOT || path.join(os.homedir(), ".zcode", "server");
  const serverNode = process.env.ZCODE_SERVER_NODE || path.join(runtimeRoot, "node");
  const serverEntry = process.env.ZCODE_SERVER_ENTRY || path.join(runtimeRoot, "zcode-server.cjs");
  if ((await pathExists(serverNode)) && (await pathExists(serverEntry))) {
    return { available: true, reason: "app_server_runtime_found", definitive: true };
  }
  return probeCommand(process.env.ZCODE_BIN || "zcode", env);
}

async function probeCodexAppServer(context: LocalCliProbeContext): Promise<ProbeVerdict> {
  const { resolveAppServerConfig } =
    await import("@omniroute/open-sse/executors/codex/appServerConfig");
  for (const connection of context.connections) {
    if (connection?.provider !== "codex-app-server") continue;
    const psd = connection.providerSpecificData;
    const record =
      psd && typeof psd === "object" && !Array.isArray(psd)
        ? (psd as Record<string, unknown>)
        : null;
    if (resolveAppServerConfig(record)) {
      return { available: true, reason: "app_server_configured", definitive: true };
    }
  }
  // Docker sidecar / bare-metal env wiring (OMNIROUTE_CODEX_APPSERVER_WS + token).
  if (resolveAppServerConfig(null)) {
    return { available: true, reason: "app_server_configured", definitive: true };
  }
  return { available: false, reason: "app_server_unconfigured", definitive: true };
}

/**
 * Cold-path wait bound for a binary probe on a cache miss. A catalog rebuild is
 * itself bounded (catalogCache.ts CATALOG_BUILD_TIMEOUT_MS, #12628), so a slow
 * `where.exe` / `command -v` (or a cold executor module load) must not eat that
 * budget: past this bound the build fails open (provider kept for this build)
 * while the probe keeps running and lands in the cache for the next build.
 */
export const LOCAL_CLI_PROBE_WAIT_MS = 1_500;

type CachedVerdict = { verdict: LocalCliAvailability; expiresAt: number };
const verdictCache = new Map<string, CachedVerdict>();
const inflightProbes = new Map<string, Promise<LocalCliAvailability>>();
let testOverrides: Record<string, boolean> | null = null;
// Test seam: a probe on a fast host can settle within the same tick as a 0 ms wait bound,
// which makes the "fail open while pending" case racy; tests inject a delay instead.
let testProbeDelayMs = 0;

async function runBinaryProbe(providerId: string, env: LookupEnv): Promise<LocalCliAvailability> {
  if (testProbeDelayMs > 0) await new Promise((r) => setTimeout(r, testProbeDelayMs));
  let verdict: ProbeVerdict;
  try {
    if (providerId === "auggie") verdict = await probeAuggie(env);
    else if (providerId === "devin-cli-agentic") verdict = await probeDevinAgentic(env);
    else if (providerId === "zcode") verdict = await probeZcode(env);
    else {
      // A new isLocalCli provider without a probe: fail open (listed) so a
      // registry addition never silently disappears from the catalog.
      return { available: true, reason: "no_probe" };
    }
  } catch {
    return { available: true, reason: "probe_error" };
  }
  const result = { available: verdict.available, reason: verdict.reason };
  if (verdict.definitive) {
    verdictCache.set(providerId, {
      verdict: result,
      expiresAt: Date.now() + LOCAL_CLI_AVAILABILITY_TTL_MS,
    });
  }
  return result;
}

/** Start (or join) the probe for `providerId`; the cache is written on settle. */
function startBinaryProbe(providerId: string, env: LookupEnv): Promise<LocalCliAvailability> {
  const inflight = inflightProbes.get(providerId);
  if (inflight) return inflight;
  const probe = runBinaryProbe(providerId, env).finally(() => {
    inflightProbes.delete(providerId);
  });
  inflightProbes.set(providerId, probe);
  return probe;
}

function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * Verdict for one provider. Binary probes are memoized stale-while-revalidate:
 * a fresh cache entry is returned as-is; an expired one is returned immediately
 * while a background re-probe refreshes it; a cache miss waits for the probe up
 * to LOCAL_CLI_PROBE_WAIT_MS and otherwise fails open for this build.
 */
async function probeProvider(
  providerId: string,
  context: LocalCliProbeContext,
  env: LookupEnv,
  options: { waitForProbeMs: number }
): Promise<LocalCliAvailability> {
  const override = testOverrides?.[providerId];
  if (typeof override === "boolean") {
    return { available: override, reason: "test_override" };
  }
  if (providerId === "codex-app-server") {
    const verdict = await probeCodexAppServer(context);
    return { available: verdict.available, reason: verdict.reason };
  }

  const cached = verdictCache.get(providerId);
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      // Refresh off the request path; errors are absorbed by runBinaryProbe.
      void startBinaryProbe(providerId, env);
    }
    return cached.verdict;
  }

  const probe = startBinaryProbe(providerId, env);
  const settled = Number.isFinite(options.waitForProbeMs)
    ? await waitAtMost(probe, options.waitForProbeMs)
    : await probe;
  return settled ?? { available: true, reason: "probe_pending" };
}

/**
 * Availability of every local-CLI no-auth provider, keyed by provider id.
 * Probes run concurrently; the caller hides providers whose `available` is false.
 * Pass `{ waitForProbeMs: Infinity }` to wait for every probe (warm-up / tests).
 */
export async function getLocalCliProviderAvailability(
  context: LocalCliProbeContext,
  options: { waitForProbeMs: number } = { waitForProbeMs: LOCAL_CLI_PROBE_WAIT_MS }
): Promise<Map<string, LocalCliAvailability>> {
  const env = getLookupEnv();
  const entries = await Promise.all(
    LOCAL_CLI_NOAUTH_PROVIDERS.map(
      async ({ id }) => [id, await probeProvider(id, context, env, options)] as const
    )
  );
  return new Map(entries);
}

/**
 * Provider ids AND aliases of the local-CLI providers that cannot serve a
 * request right now — the catalog folds them into the same gate as
 * `settings.blockedProviders`, so every listing loop hides them uniformly.
 */
export async function getUnavailableLocalCliProviderKeys(
  context: LocalCliProbeContext
): Promise<Set<string>> {
  const availability = await getLocalCliProviderAvailability(context);
  const keys = new Set<string>();
  for (const { id, alias } of LOCAL_CLI_NOAUTH_PROVIDERS) {
    if (availability.get(id)?.available !== false) continue;
    keys.add(id);
    if (alias) keys.add(alias);
  }
  return keys;
}

/** Test hook: force verdicts per provider id (`null` restores the real probes). */
export function __setLocalCliProbeDelayForTest(ms: number): void {
  testProbeDelayMs = Math.max(0, ms);
}

export function __setLocalCliAvailabilityForTest(overrides: Record<string, boolean> | null): void {
  testOverrides = overrides ? { ...overrides } : null;
}

/** Test hook: drop memoized probe verdicts and wait for any in-flight probe to settle. */
export async function __resetLocalCliAvailabilityCacheForTest(): Promise<void> {
  await Promise.allSettled([...inflightProbes.values()]);
  verdictCache.clear();
}

/**
 * Startup warm-up (final audit D-4): probe the binary-backed providers before the first
 * catalogue build, so a cold build never waits on `where` / `command -v` inside its 8 s
 * budget and never has to fail open for a whole cache cycle. codex-app-server is derived
 * from configuration on every build and needs no warm-up. Never throws.
 */
export function warmLocalCliProviderAvailability(): Promise<void> {
  return getLocalCliProviderAvailability({ connections: [] }, { waitForProbeMs: Infinity }).then(
    () => undefined,
    () => undefined
  );
}
