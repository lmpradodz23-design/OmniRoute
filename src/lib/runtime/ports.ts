const DEFAULT_PORT = 20128;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

export type RuntimePorts = {
  port: number;
  apiPort: number;
  dashboardPort: number;
  apiPortExplicit: boolean;
  dashboardPortExplicit: boolean;
};

// `env` is injectable so pure consumers (e.g. the live WebSocket Origin
// allow-list) can be unit-tested against a synthetic environment.
export function getRuntimePorts(env: NodeJS.ProcessEnv = process.env): RuntimePorts {
  // OMNIROUTE_PORT preserves the user's canonical PORT in wrapped runtimes
  // where Next.js requires process.env.PORT to be the dashboard listener port.
  const basePort = parsePort(env.OMNIROUTE_PORT || env.PORT, DEFAULT_PORT);
  const apiPortExplicit = !!env.API_PORT;
  const dashboardPortExplicit = !!env.DASHBOARD_PORT;

  return {
    port: basePort,
    apiPort: parsePort(env.API_PORT, basePort),
    dashboardPort: parsePort(env.DASHBOARD_PORT, basePort),
    apiPortExplicit,
    dashboardPortExplicit,
  };
}
