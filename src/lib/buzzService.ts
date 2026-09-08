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
  getPublicKey,
  resolveBuzzAdapter,
  type BuzzAdapter,
  type WebSocketBuzzConfig,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

import {
  buzzCounts,
  markOutbox,
  pendingOutbox,
  requeueFailedOutbox,
  type BuzzCounts,
} from "./db/buzzBridge";
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

/**
 * URL do relay, com precedência: override do painel (key_value) → env BUZZ_RELAY_URL → default.
 * Assim o PAINEL ÚNICO configura tudo, sem perder a opção de fixar por ambiente.
 */
export function getBuzzRelayUrl(): string {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'buzz' AND key = 'relay_url'")
    .get() as { value: string } | undefined;
  return row?.value?.trim() || process.env.BUZZ_RELAY_URL?.trim() || "ws://localhost:3000";
}

/** Persiste a URL do relay definida no painel. String vazia remove o override (volta ao env/default). */
export function setBuzzRelayUrl(url: string): string {
  const db = getDbInstance();
  const trimmed = url.trim();
  if (!trimmed) {
    db.prepare("DELETE FROM key_value WHERE namespace = 'buzz' AND key = 'relay_url'").run();
  } else {
    db.prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('buzz', 'relay_url', ?)"
    ).run(trimmed);
  }
  return getBuzzRelayUrl();
}

/** Config do relay (URL do painel/env + chave persistida). */
export function getBuzzConfig(): WebSocketBuzzConfig {
  return {
    relayUrl: getBuzzRelayUrl(),
    secretKeyHex: getOrCreateAgentSecretKey(),
  };
}

/** Adaptador conforme a flag: real (WebSocket) quando BUZZ_HUB_ENABLED, senão inerte. */
export function getBuzzAdapter(): BuzzAdapter {
  const enabled = isFeatureFlagEnabled("BUZZ_HUB_ENABLED");
  return resolveBuzzAdapter(enabled, enabled ? getBuzzConfig() : undefined);
}

export interface BuzzStatus {
  enabled: boolean;
  relayUrl: string;
  /** Chave PÚBLICA Nostr do agente (nunca a secreta). Identidade estável do OmniRoute no relay. */
  agentPubkey: string;
  counts: BuzzCounts;
}

/**
 * Estado do Buzz para o painel único: flag, URL do relay, pubkey do agente e contagens do
 * outbox/inbox. NUNCA expõe a chave secreta. Não conecta ao relay (leitura local, barata).
 */
export function getBuzzStatus(): BuzzStatus {
  return {
    enabled: isFeatureFlagEnabled("BUZZ_HUB_ENABLED"),
    relayUrl: getBuzzRelayUrl(),
    agentPubkey: getPublicKey(getOrCreateAgentSecretKey()),
    counts: buzzCounts(),
  };
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
  // Reenfileira falhas transitórias (sob o teto de tentativas) antes de coletar as pendentes, para
  // que uma queda passageira do relay não estrangule a mensagem em 'failed' para sempre.
  requeueFailedOutbox();
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
