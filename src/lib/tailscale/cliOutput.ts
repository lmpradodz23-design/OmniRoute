/**
 * Parsing of `tailscale` CLI output for the tunnel manager (tailscaleTunnel.ts):
 * the JSON payloads of `tailscale status` / `tailscale serve status` and the login,
 * enable and Funnel URLs printed in plain text. Pure functions — no I/O.
 */

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isBackendRunning(payload: unknown) {
  return toNonEmptyString(asRecord(payload).BackendState) === "Running";
}

export function isFunnelRunning(payload: unknown) {
  const allowFunnel = asRecord(payload).AllowFunnel;
  return Boolean(
    allowFunnel && typeof allowFunnel === "object" && Object.keys(allowFunnel).length > 0
  );
}

export function getTailscaleUrlFromStatusPayload(payload: unknown) {
  const self = asRecord(asRecord(payload).Self);
  const dnsName = toNonEmptyString(self.DNSName);
  if (!dnsName) return null;
  const normalized = dnsName.replace(/\.$/, "");
  return normalized ? `https://${normalized}` : null;
}

export function extractTailscaleAuthUrl(text: string) {
  const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9-]+/);
  return match ? match[0] : null;
}

export function extractTailscaleEnableUrl(text: string) {
  const match = text.match(/https:\/\/login\.tailscale\.com\/[^\s"']+/);
  return match ? match[0] : null;
}

export function extractTailscaleFunnelUrl(text: string) {
  const match = text.match(/https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net\b[^\s"']*/i);
  if (!match) return null;
  return match[0].replace(/\/$/, "");
}
