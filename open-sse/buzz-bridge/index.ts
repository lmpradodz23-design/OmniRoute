/**
 * Buzz Bridge — API pública (ponte OmniRoute ↔ Block Buzz), atrás da flag `buzz_hub` (OFF).
 *
 * Buzz é serviço SEPARADO (relay Nostr). Este módulo é a ponte tipada + idempotente; nada
 * conecta enquanto desabilitado. Configuração e controle ficam no PAINEL ÚNICO do OmniRoute.
 * A persistência do outbox/inbox vive em src/lib/db/buzzBridge.ts (não há fila in-memory).
 */
export * from "./types.ts";
export { DisabledBuzzAdapter } from "./adapter.ts";
export {
  finalizeEvent,
  verifyEvent,
  getPublicKey,
  generateSecretKey,
  type SignedNostrEvent,
  type UnsignedNostrEvent,
} from "./nostr.ts";
export {
  validateBuzzRelayUrl,
  type BuzzRelayUrlCheck,
  type BuzzRelayUrlErrorCode,
} from "./relayUrl.ts";
export {
  isWellFormedRelayEvent,
  MAX_EVENT_CONTENT_BYTES,
  MAX_EVENT_TAGS,
  MAX_RELAY_FRAME_BYTES,
  MAX_TAG_ITEM_CHARS,
  MAX_TAG_ITEMS,
} from "./eventShape.ts";
export {
  DEFAULT_BUZZ_AUTH_TIMEOUT_MS,
  DEFAULT_BUZZ_TIMEOUT_MS,
  WebSocketBuzzAdapter,
  type WebSocketBuzzConfig,
} from "./wsAdapter.ts";

import { DisabledBuzzAdapter } from "./adapter.ts";
import type { BuzzAdapter } from "./types.ts";
import { WebSocketBuzzAdapter, type WebSocketBuzzConfig } from "./wsAdapter.ts";

/**
 * Resolve o adaptador: inerte quando `buzz_hub` OFF ou sem config; WebSocketBuzzAdapter real
 * (contra o buzz-relay) quando a flag está ON e há config (relayUrl + secretKey).
 */
export function resolveBuzzAdapter(
  flagEnabled: boolean,
  config?: WebSocketBuzzConfig
): BuzzAdapter {
  if (!flagEnabled || !config?.relayUrl || !config?.secretKeyHex) {
    return new DisabledBuzzAdapter();
  }
  return new WebSocketBuzzAdapter(config);
}
