/**
 * Buzz Service — integra o Buzz ao OmniRoute (config + adaptador + flush do outbox).
 *
 * - Identidade Nostr do agente: gerada quando o hub é ATIVADO (status com a flag ON) ou na
 *   primeira publicação/assinatura, e PERSISTIDA CIFRADA (key_value namespace 'buzz', via
 *   `encryptSensitive` — fail-closed no perfil que exige criptografia). Uma leitura com a flag
 *   OFF nunca cria a identidade (auditoria B-L2); um valor legado em texto puro é migrado para
 *   ciphertext na primeira leitura (B-H1). Chave cifrada com STORAGE_ENCRYPTION_KEY trocada →
 *   erro explícito, nunca uma identidade nova silenciosa.
 * - Config do relay: override do painel → env BUZZ_RELAY_URL → default VAZIO (desligado até
 *   configurar; o antigo `ws://localhost:3000` colidia com a porta do próprio OmniRoute).
 *   Toda URL passa por `validateBuzzRelayUrl` (B-M2): sem credenciais/query/fragment, sem
 *   metadata/hosts privados (loopback permitido), wss:// obrigatório fora de loopback.
 * - flushBuzzOutbox: publica as entradas elegíveis do outbox no relay real (idempotente), com
 *   retry/backoff persistido e um teto de tempo total (A-H3 / B-M3).
 *
 * Gated por BUZZ_HUB_ENABLED (OFF por padrão). Sem flag/relay, tudo fica inerte e durável no DB.
 */
import {
  DEFAULT_BUZZ_AUTH_TIMEOUT_MS,
  DEFAULT_BUZZ_TIMEOUT_MS,
  generateSecretKey,
  getPublicKey,
  resolveBuzzAdapter,
  validateBuzzRelayUrl,
  type BuzzAdapter,
  type BuzzRelayUrlErrorCode,
  type WebSocketBuzzConfig,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

import { buzzCounts, markOutbox, pendingOutbox, type BuzzCounts } from "./db/buzzBridge";
import { getDbInstance } from "./db/core";
import { decrypt, encryptSensitive, isEncryptionEnabled, looksEncrypted } from "./db/encryption";
import { DEFAULT_TENANT } from "./db/loopEngine";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

const KV_NAMESPACE = "buzz";
const KV_AGENT_SECRET_KEY = "agent_sk";
const KV_RELAY_URL = "relay_url";

/** Default do relay: vazio = ponte desligada até o operador configurar uma URL válida. */
export const DEFAULT_BUZZ_RELAY_URL = "";
/** Teto de tempo total de um flush (connect + publicações), em ms. */
export const FLUSH_DEADLINE_MS = 30_000;

/** A chave persistida existe mas não decifra (STORAGE_ENCRYPTION_KEY trocada/ausente). */
export class BuzzIdentityUnavailableError extends Error {
  constructor() {
    super(
      "Buzz agent key is undecryptable: STORAGE_ENCRYPTION_KEY changed or is unset — restore the key or reset the Buzz identity"
    );
    this.name = "BuzzIdentityUnavailableError";
  }
}

/** URL de relay rejeitada pela validação (`code` tipado para a API). */
export class BuzzRelayUrlError extends Error {
  constructor(
    readonly code: BuzzRelayUrlErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BuzzRelayUrlError";
  }
}

function readKv(key: string): string | undefined {
  const row = getDbInstance()
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(KV_NAMESPACE, key) as { value: string } | undefined;
  return typeof row?.value === "string" ? row.value : undefined;
}

function writeKv(key: string, value: string): void {
  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(KV_NAMESPACE, key, value);
}

/**
 * Chave secreta Nostr do agente — leitura SEM efeito de criação. Retorna null se ainda não
 * existe. Migra transparentemente um valor legado em texto puro para ciphertext quando há
 * STORAGE_ENCRYPTION_KEY. Lança BuzzIdentityUnavailableError se o ciphertext não decifra.
 */
export function getAgentSecretKey(): string | null {
  const stored = readKv(KV_AGENT_SECRET_KEY);
  if (!stored) return null;
  if (looksEncrypted(stored)) {
    const plain = decrypt(stored);
    if (!plain) throw new BuzzIdentityUnavailableError();
    return plain;
  }
  if (isEncryptionEnabled()) {
    // Legado em texto puro: re-grava cifrado (encryptSensitive é fail-closed no perfil exposto).
    writeKv(KV_AGENT_SECRET_KEY, encryptSensitive(stored) ?? stored);
  }
  return stored;
}

/**
 * Chave secreta do agente, criando-a na primeira chamada. A escrita passa por `encryptSensitive`:
 * no perfil que exige criptografia sem STORAGE_ENCRYPTION_KEY lança EncryptionUnavailableError
 * e NADA é persistido (nunca texto puro em repouso).
 */
export function getOrCreateAgentSecretKey(): string {
  const existing = getAgentSecretKey();
  if (existing) return existing;
  const sk = generateSecretKey();
  writeKv(KV_AGENT_SECRET_KEY, encryptSensitive(sk) ?? sk);
  return sk;
}

/** Chave PÚBLICA do agente, ou null se a identidade ainda não foi criada. */
export function getAgentPubkey(): string | null {
  const sk = getAgentSecretKey();
  return sk ? getPublicKey(sk) : null;
}

const warnedRelayUrlSources = new Set<string>();

/** Loga (uma vez por fonte+motivo) que uma URL configurada foi ignorada — sem ecoar a URL. */
function warnIgnoredRelayUrl(source: "override" | "env", code: BuzzRelayUrlErrorCode): void {
  const key = `${source}:${code}`;
  if (warnedRelayUrlSources.has(key)) return;
  warnedRelayUrlSources.add(key);
  console.warn(`[BUZZ] Ignoring relay URL from ${source}: ${code} (bridge stays disabled)`);
}

/**
 * URL do relay, com precedência: override do painel (key_value) → env BUZZ_RELAY_URL → default
 * (vazio). Cada fonte é validada; uma fonte inválida é ignorada (log redigido) e a próxima é
 * consultada. Nunca devolve uma URL com credenciais, query, fragment, metadata ou host privado.
 */
export function getBuzzRelayUrl(): string {
  const override = readKv(KV_RELAY_URL)?.trim();
  if (override) {
    const check = validateBuzzRelayUrl(override);
    if (check.ok === true) return check.url;
    warnIgnoredRelayUrl("override", check.code);
  }
  const fromEnv = process.env.BUZZ_RELAY_URL?.trim();
  if (fromEnv) {
    const check = validateBuzzRelayUrl(fromEnv);
    if (check.ok === true) return check.url;
    warnIgnoredRelayUrl("env", check.code);
  }
  return DEFAULT_BUZZ_RELAY_URL;
}

/**
 * Persiste a URL do relay definida no painel (validada; lança BuzzRelayUrlError se rejeitada).
 * String vazia remove o override (volta ao env/default).
 */
export function setBuzzRelayUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    getDbInstance()
      .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
      .run(KV_NAMESPACE, KV_RELAY_URL);
    return getBuzzRelayUrl();
  }
  const check = validateBuzzRelayUrl(trimmed);
  if (check.ok === false) throw new BuzzRelayUrlError(check.code, check.message);
  writeKv(KV_RELAY_URL, check.url);
  return getBuzzRelayUrl();
}

/** Config do relay (URL do painel/env + chave persistida, criada se necessário). */
export function getBuzzConfig(): WebSocketBuzzConfig {
  return {
    relayUrl: getBuzzRelayUrl(),
    secretKeyHex: getOrCreateAgentSecretKey(),
  };
}

/**
 * Adaptador conforme a flag: real (WebSocket) quando BUZZ_HUB_ENABLED e há relay válido,
 * senão inerte. `extra` permite ao chamador (consumidor) ligar `onClose`/timeouts.
 */
export function getBuzzAdapter(
  extra: Partial<Pick<WebSocketBuzzConfig, "onClose" | "timeoutMs" | "authTimeoutMs">> = {}
): BuzzAdapter {
  const enabled = isFeatureFlagEnabled("BUZZ_HUB_ENABLED");
  if (!enabled || !getBuzzRelayUrl()) return resolveBuzzAdapter(false);
  return resolveBuzzAdapter(true, { ...getBuzzConfig(), ...extra });
}

export type BuzzIdentityStatus = "ok" | "missing" | "undecryptable";

export interface BuzzStatus {
  enabled: boolean;
  relayUrl: string;
  /** Há uma URL de relay válida (painel ou env). */
  relayConfigured: boolean;
  /** Chave PÚBLICA Nostr do agente (nunca a secreta); null enquanto a identidade não existe. */
  agentPubkey: string | null;
  identityStatus: BuzzIdentityStatus;
  counts: BuzzCounts;
}

/**
 * Estado do Buzz para o painel único. NUNCA expõe a chave secreta. Não conecta ao relay.
 * Com a flag ON a leitura ATIVA o hub (cria a identidade); com a flag OFF é só leitura (B-L2).
 */
export function getBuzzStatus(): BuzzStatus {
  const enabled = isFeatureFlagEnabled("BUZZ_HUB_ENABLED");
  const relayUrl = getBuzzRelayUrl();
  let agentPubkey: string | null = null;
  let identityStatus: BuzzIdentityStatus = "missing";
  try {
    agentPubkey = enabled ? getPublicKey(getOrCreateAgentSecretKey()) : getAgentPubkey();
    if (agentPubkey) identityStatus = "ok";
  } catch (err) {
    if (!(err instanceof BuzzIdentityUnavailableError)) throw err;
    identityStatus = "undecryptable";
  }
  return {
    enabled,
    relayUrl,
    relayConfigured: relayUrl !== "",
    agentPubkey,
    identityStatus,
    counts: buzzCounts(),
  };
}

export interface FlushOptions {
  /** Máximo de entradas por flush. */
  limit?: number;
  /** Teto de tempo total (connect + publicações), em ms. */
  deadlineMs?: number;
  /** Relógio lógico para elegibilidade/agendamento de retry (injetável em testes). */
  now?: number;
}

export interface FlushResult {
  published: number;
  failed: number;
  skipped: boolean;
  /** true quando o teto de tempo interrompeu o flush; o restante fica pendente. */
  deadlineReached: boolean;
  reason?: string;
}

function skippedFlush(reason: string): FlushResult {
  return { published: 0, failed: 0, skipped: true, deadlineReached: false, reason };
}

/**
 * Motivo curto e REDIGIDO de um erro de relay para logs: código (ECONNREFUSED, timeout…) ou nome
 * da classe — nunca a mensagem, que pode conter host:porta do relay.
 */
export function describeRelayError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return code;
  if (err instanceof Error) return /timeout/i.test(err.message) ? "timeout" : err.name;
  return "error";
}

/**
 * Publica as entradas elegíveis do outbox no relay. Idempotente (dedup do relay por id de
 * evento). Skipped quando a flag está OFF ou não há relay configurado. Falhas são marcadas com
 * backoff e retentadas em flushes futuros. Lança se a conexão com o relay falhar (o chamador
 * decide a resposta — sem vazar a mensagem crua).
 */
export async function flushBuzzOutbox(options: FlushOptions = {}): Promise<FlushResult> {
  const { limit = 50, deadlineMs = FLUSH_DEADLINE_MS, now = Date.now() } = options;
  if (!isFeatureFlagEnabled("BUZZ_HUB_ENABLED")) return skippedFlush("BUZZ_HUB_ENABLED is off");
  const relayUrl = getBuzzRelayUrl();
  if (!relayUrl) return skippedFlush("relay not configured");
  const pending = pendingOutbox(limit, DEFAULT_TENANT, now);
  if (pending.length === 0)
    return { published: 0, failed: 0, skipped: false, deadlineReached: false };

  const startedAt = Date.now();
  const deadlineAt = startedAt + deadlineMs;
  const adapter = resolveBuzzAdapter(true, {
    relayUrl,
    secretKeyHex: getOrCreateAgentSecretKey(),
    timeoutMs: Math.min(DEFAULT_BUZZ_TIMEOUT_MS, deadlineMs),
    authTimeoutMs: Math.min(DEFAULT_BUZZ_AUTH_TIMEOUT_MS, deadlineMs),
  });
  if (!adapter.enabled) return skippedFlush("relay not configured");

  await adapter.connect();
  let published = 0;
  let failed = 0;
  let deadlineReached = false;
  try {
    for (const entry of pending) {
      if (Date.now() >= deadlineAt) {
        deadlineReached = true;
        break;
      }
      const ok = await adapter.publish(entry);
      markOutbox(entry.id, ok ? "published" : "failed", now);
      if (ok) published++;
      else failed++;
    }
  } finally {
    await adapter.close();
  }
  return { published, failed, skipped: false, deadlineReached };
}
