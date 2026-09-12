/**
 * Webhook Dispatcher
 * Dispatches events to registered webhooks with HMAC-SHA256 signing and retries.
 * Slack/Telegram/Discord use per-kind payload transformers (no HMAC wrapping).
 */

import crypto from "crypto";
import { decrypt, encryptSensitive } from "./db/encryption";
import { arePrivateProviderUrlsAllowed } from "@/shared/network/outboundUrlGuardPolicy";
import { OutboundUrlGuardError } from "@/shared/network/outboundUrlGuard";
import { hardenedWebhookFetch, type WebhookLookupFn } from "@/shared/network/hardenedWebhookFetch";
import type { WebhookEvent } from "./webhooks/eventDescriptions";

export type { WebhookEvent };

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, any>;
}

function signPayload(payload: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function encryptMetadata(meta: Record<string, string>): string {
  return encryptSensitive(JSON.stringify(meta)) ?? JSON.stringify(meta); // #3: fail-closed in prod
}

export function decryptMetadata(encrypted: string | null): Record<string, string> | null {
  if (!encrypted) return null;
  const raw = decrypt(encrypted);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Per-delivery overrides. `lookup` and `allowPrivate` exist so the SSRF properties are
 * unit-testable without real DNS or the global opt-in. Production callers pass nothing and get
 * real resolution plus the operator's `OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS` policy — the same
 * policy `/api/webhooks/[id]/test` applies, so the diagnostic and the real delivery agree.
 */
export interface DeliverOptions {
  lookup?: WebhookLookupFn;
  allowPrivate?: boolean;
  timeoutMs?: number;
}

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * URL-free description of a guard decision for the delivery log. The guard's own message
 * embeds the full target URL — and for Telegram that URL carries the bot token in its path —
 * so neither `error.message` nor `error.url` may ever be persisted or surfaced as the delivery
 * error.
 */
function describeGuardBlock(error: OutboundUrlGuardError): string {
  if (/redirect/i.test(error.message)) return "Blocked: redirect not followed (outbound guard)";
  if (/metadata/i.test(error.message)) return "Blocked: cloud metadata target";
  if (/No DNS records/i.test(error.message)) return "Blocked: hostname did not resolve";
  if (error.code === "OUTBOUND_URL_INVALID") return "Blocked: invalid outbound URL";
  return "Blocked: private/reserved outbound target";
}

function deliveryHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": "OmniRoute-Webhook/1.0",
    ...extra,
  };
}

/**
 * Hardened single-shot delivery (SSRF finding S-1). `hardenedWebhookFetch` applies the
 * string-level checks (scheme, embedded credentials, literal private/metadata hosts) BEFORE any
 * DNS or socket — governed by `allowPrivate` rather than only the global flag — then resolves
 * and validates every address, pins the connection to the validated ip (no rebinding between
 * check and connect), never follows redirects, and never reads a private target's body. A guard
 * decision is reported as `status: 0` with a URL-free error, so the delivery log can never act
 * as a blind-SSRF oracle for an internal service's real status.
 */
export async function deliverRaw(
  url: string,
  body: Record<string, unknown>,
  options: DeliverOptions = {}
): Promise<{ success: boolean; status: number; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await hardenedWebhookFetch(url, {
      method: "POST",
      headers: deliveryHeaders(),
      body: JSON.stringify(body),
      timeoutMs: options.timeoutMs ?? DELIVERY_TIMEOUT_MS,
      allowPrivate: options.allowPrivate ?? arePrivateProviderUrlsAllowed(),
      lookup: options.lookup,
      maxBodyBytes: 0,
    });
    return { success: res.ok, status: res.status, latencyMs: Date.now() - start };
  } catch (error: any) {
    return {
      success: false,
      status: 0,
      latencyMs: Date.now() - start,
      error:
        error instanceof OutboundUrlGuardError
          ? describeGuardBlock(error)
          : error?.message || "Network error",
    };
  }
}

export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret?: string | null,
  maxRetries = 3,
  options: DeliverOptions = {}
): Promise<{ success: boolean; status: number; error?: string }> {
  const body = JSON.stringify(payload);
  const headers = deliveryHeaders({
    "X-Webhook-Event": payload.event,
    "X-Webhook-Timestamp": payload.timestamp,
  });

  if (secret) {
    headers["X-Webhook-Signature"] = signPayload(body, secret);
  }

  // Resolved once, outside the retry loop: the policy read may touch the settings store.
  const allowPrivate = options.allowPrivate ?? arePrivateProviderUrlsAllowed();

  // Last genuine upstream status seen on a retried 5xx. Reported when retries are exhausted so
  // the delivery log records the real upstream failure (e.g. 503) — as opposed to `status: 0`,
  // which is reserved for "no HTTP response": guard blocks and network errors.
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // The abort timer is owned by hardenedWebhookFetch and cleared in its `finally` on every
      // path, so a rejected connection can no longer leak a dangling 10s timer per attempt.
      const res = await hardenedWebhookFetch(url, {
        method: "POST",
        headers,
        body,
        timeoutMs: options.timeoutMs ?? DELIVERY_TIMEOUT_MS,
        allowPrivate,
        lookup: options.lookup,
        maxBodyBytes: 0,
      });

      if (res.ok || res.status < 500) {
        return { success: res.ok, status: res.status };
      }

      lastStatus = res.status;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    } catch (error: any) {
      if (error instanceof OutboundUrlGuardError) {
        // A blocked or redirected target is a policy decision, not a transient fault. Retrying
        // would re-resolve and re-probe the same internal address up to `maxRetries` more times
        // and turn the delivery log into a blind-SSRF oracle — terminate immediately.
        return { success: false, status: 0, error: describeGuardBlock(error) };
      }
      if (attempt === maxRetries) {
        return { success: false, status: 0, error: error?.message || "Network error" };
      }
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  return { success: false, status: lastStatus, error: "Max retries exceeded" };
}

/**
 * Fire-and-forget wrapper around `dispatchEvent`. Safe to call from hot paths
 * (combo loop, executor exit) — never throws, never blocks. Use this from
 * production callers; reserve `dispatchEvent` for places that genuinely want
 * to await delivery (CLI/admin tooling, tests).
 */
export function notifyWebhookEvent(event: WebhookEvent, data: Record<string, any>): void {
  // Intentionally not awaited. Promise.allSettled inside dispatchEvent already
  // absorbs per-delivery errors; this outer catch handles the import/loader
  // path so a misconfigured webhook table cannot break a request.
  dispatchEvent(event, data).catch(() => {
    /* webhook delivery is best-effort */
  });
}

/**
 * Dispatch an event to all matching enabled webhooks.
 * Routes by kind: slack/discord use raw payload helpers; telegram decrypts botToken from metadata;
 * custom uses HMAC-signed deliverWebhook.
 */
export async function dispatchEvent(event: WebhookEvent, data: Record<string, any>): Promise<void> {
  const { getEnabledWebhooks, recordWebhookDelivery, disableWebhooksWithHighFailures } =
    await import("./db/webhooks");
  const { insertDelivery } = await import("./db/webhookDeliveries");
  const { buildSlackPayload } = await import("./webhooks/integrations/slack");
  const { buildTelegramUrl, buildTelegramPayload } =
    await import("./webhooks/integrations/telegram");
  const { buildDiscordPayload } = await import("./webhooks/integrations/discord");

  const webhooks = getEnabledWebhooks();
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const deliveries = webhooks
    .filter((wh) => wh.events.includes("*") || wh.events.includes(event))
    .map(async (wh) => {
      const kind = wh.kind ?? "custom";
      const start = Date.now();
      let result: { success: boolean; status: number; error?: string };

      try {
        if (kind === "slack") {
          const slackPayload = buildSlackPayload(event, data);
          result = await deliverRaw(wh.url, slackPayload as unknown as Record<string, unknown>);
        } else if (kind === "discord") {
          const discordPayload = buildDiscordPayload(event, data);
          result = await deliverRaw(wh.url, discordPayload as unknown as Record<string, unknown>);
        } else if (kind === "telegram") {
          const meta = decryptMetadata(wh.metadata_encrypted ?? null);
          const botToken = meta?.botToken;
          if (!botToken) {
            result = { success: false, status: 0, error: "Missing Telegram botToken in metadata" };
          } else {
            const apiUrl = buildTelegramUrl(botToken);
            // For Telegram, wh.url stores the chat_id
            const tgPayload = buildTelegramPayload(event, data, wh.url);
            result = await deliverRaw(apiUrl, tgPayload as unknown as Record<string, unknown>);
          }
        } else {
          result = await deliverWebhook(wh.url, payload, wh.secret);
        }
      } catch (err: any) {
        result = { success: false, status: 0, error: err.message || "Dispatch error" };
      }

      const latencyMs = Date.now() - start;

      try {
        insertDelivery({
          webhookId: wh.id,
          eventType: event,
          status: result.success ? "success" : "failed",
          httpStatus: result.status || null,
          latencyMs,
          error: result.error ?? null,
          payloadSnapshot: kind === "custom" ? JSON.stringify(payload).slice(0, 2000) : null,
        });
      } catch {
        // Delivery logging is best-effort
      }

      recordWebhookDelivery(wh.id, result.status, result.success);
      return { webhookId: wh.id, ...result };
    });

  await Promise.allSettled(deliveries);
  disableWebhooksWithHighFailures(10);
}
