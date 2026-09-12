import { updateToolHealth } from "@/lib/db/versionManager";
import { guardedFetch } from "@/shared/network/guardedFetch";
import { areIntegrationPrivateUrlsAllowed } from "@/shared/network/outboundUrlGuardPolicy";

interface HealthResult {
  healthy: boolean;
  latency: number;
  modelCount: number;
  error: string | null;
}

const monitoringIntervals = new Map<string, NodeJS.Timeout>();

async function checkHealth(url: string, healthPath?: string): Promise<HealthResult> {
  const basePath = healthPath || "/v1/models";
  const start = Date.now();

  try {
    // SSRF S-6: the managed-tool URL is operator data — resolved address validated (cloud
    // metadata never; loopback/LAN under the local-first integration policy), connection
    // pinned, redirects never followed. Guard decisions surface through `error` like any
    // other probe failure.
    const res = await guardedFetch(`${url}${basePath}`, {
      timeoutMs: 5000,
      headers: { Authorization: "Bearer omniroute-internal" },
      allowPrivate: areIntegrationPrivateUrlsAllowed(),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      return { healthy: false, latency, modelCount: 0, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const modelCount = Array.isArray(data.data) ? data.data.length : 0;

    return { healthy: true, latency, modelCount, error: null };
  } catch (err) {
    const latency = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { healthy: false, latency, modelCount: 0, error: message };
  }
}

export { checkHealth };
export type { HealthResult };

export function startMonitoring(
  tool: string,
  url: string,
  intervalMs: number = 30_000,
  healthPath?: string
): void {
  stopMonitoring(tool);

  const doCheck = async () => {
    const result = await checkHealth(url, healthPath);
    const status = result.healthy ? "healthy" : "unhealthy";
    await updateToolHealth(tool, status).catch(() => {});
  };

  doCheck();
  const timer = setInterval(doCheck, intervalMs);
  monitoringIntervals.set(tool, timer);
}

export function stopMonitoring(tool: string): void {
  const timer = monitoringIntervals.get(tool);
  if (timer) {
    clearInterval(timer);
    monitoringIntervals.delete(tool);
  }
}

export function isMonitoring(tool: string): boolean {
  return monitoringIntervals.has(tool);
}
