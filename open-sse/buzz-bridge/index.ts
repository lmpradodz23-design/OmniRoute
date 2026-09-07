/**
 * Buzz Bridge — API pública (ponte OmniRoute ↔ Block Buzz), atrás da flag `buzz_hub` (OFF).
 *
 * Buzz é serviço SEPARADO (relay Nostr). Este módulo é a ponte tipada + idempotente; nada
 * conecta enquanto desabilitado. Configuração e controle ficam no PAINEL ÚNICO do OmniRoute.
 */
export * from "./types.ts";
export { Outbox, Inbox } from "./outbox.ts";
export { DisabledBuzzAdapter, buzzIdentityIsMapped, nostrKeyAuthorizes } from "./adapter.ts";

import { DisabledBuzzAdapter } from "./adapter.ts";
import type { BuzzAdapter } from "./types.ts";

/**
 * Resolve o adaptador conforme a flag. Enquanto `buzz_hub` estiver OFF, retorna o inerte.
 * O WebSocketBuzzAdapter (real) entra quando o relay rodar (requer disco/serviços) e a flag ON.
 */
export function resolveBuzzAdapter(flagEnabled: boolean): BuzzAdapter {
  if (!flagEnabled) return new DisabledBuzzAdapter();
  // Futuro: return new WebSocketBuzzAdapter(config) quando o buzz-relay estiver disponível.
  return new DisabledBuzzAdapter();
}
