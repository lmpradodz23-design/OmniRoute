/**
 * Buzz Service — integra o Buzz ao OmniRoute (config + adaptador + flush do outbox).
 *
 * - Identidade Nostr do agente: gerada uma vez e PERSISTIDA (key_value namespace 'buzz'),
 *   estável entre reinícios.
 * - Config do relay: BUZZ_RELAY_URL (default ws://localhost:3000). Configurável no painel único.
 * - flushBuzzOutbox: publica as entradas pendentes do outbox no relay real (idempotente).
 *
 * Gated por BUZZ_HUB_ENABLED (OFF por padrão). Sem flag/relay, tudo fica inerte e durável no DB.
 */
import {
  generateSecretKey,
  resolveBuzzAdapter,
  type BuzzAdapter,
  type WebSocketBuzzConfig,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

import { markOutbox, pendingOutbox } from "./db/buzzBridge";
import { getDbInstance } from "./db/core";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

/** Chave secreta Nostr do agente OmniRoute, persistida e estável. */
export function getOrCreateAgentSecretKey(): string {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'buzz' AND key = 'agent_sk'")
    .get() as { value: string } | undefined;
  if (row?.value) return row.value;
  const sk = generateSecretKey();
  db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'agent_sk', ?)"
  ).run(sk);
  return sk;
}

/** Config do relay (URL do painel/env + chave persistida). */
export function getBuzzConfig(): WebSocketBuzzConfig {
  return {
    relayUrl: process.env.BUZZ_RELAY_URL?.trim() || "ws://localhost:3000",
    secretKeyHex: getOrCreateAgentSecretKey(),
  };
}

/** Adaptador conforme a flag: real (WebSocket) quando BUZZ_HUB_ENABLED, senão inerte. */
export function getBuzzAdapter(): BuzzAdapter {
  const enabled = isFeatureFlagEnabled("BUZZ_HUB_ENABLED");
  return resolveBuzzAdapter(enabled, enabled ? getBuzzConfig() : undefined);
}

export interface FlushResult {
  published: number;
  failed: number;
  skipped: boolean;
}

/**
 * Publica as entradas pendentes do outbox no relay. Idempotente (dedup do relay por id de
 * evento). Retorna a contagem. Skipped quando a flag está OFF ou não há relay/pendentes.
 */
export async function flushBuzzOutbox(limit = 50): Promise<FlushResult> {
  if (!isFeatureFlagEnabled("BUZZ_HUB_ENABLED")) {
    return { published: 0, failed: 0, skipped: true };
  }
  const pending = pendingOutbox(limit);
  if (pending.length === 0) return { published: 0, failed: 0, skipped: false };

  const adapter = resolveBuzzAdapter(true, getBuzzConfig());
  if (!adapter.enabled) return { published: 0, failed: 0, skipped: true };

  await adapter.connect();
  let published = 0;
  let failed = 0;
  try {
    for (const entry of pending) {
      const ok = await adapter.publish(entry);
      if (ok) {
        markOutbox(entry.id, "published");
        published++;
      } else {
        markOutbox(entry.id, "failed");
        failed++;
      }
    }
  } finally {
    await adapter.close();
  }
  return { published, failed, skipped: false };
}
