/**
 * Buzz Consumer — liga o relay ao inbox do OmniRoute (fecha o gap "sem consumidor de produção").
 *
 * Assina o relay (flag ON) e roteia cada evento recebido para `receiveInbox` — que apenas
 * DEDUPLICA e ARMAZENA. NÃO há caminho daqui para qualquer efeito no OmniRoute: uma chave/assinatura
 * Nostr nunca autoriza uma ação (as decisões ficam com o Policy Engine, fora deste módulo). Inbound
 * é só sinal/colaboração para humanos verem no painel. Opt-in e best-effort.
 */
import type { BuzzSubscriptionFilter } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { getBuzzAdapter } from "./buzzService";
import { receiveInbox } from "./db/buzzBridge";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export interface InboxSubscription {
  started: boolean;
  /** Encerra a assinatura e fecha a conexão. */
  stop: () => Promise<void>;
}

/**
 * Inicia a assinatura do inbox. Retorna { started:false } quando a flag BUZZ_HUB_ENABLED está OFF
 * (nada conecta). Cada evento verificado é persistido via receiveInbox (dedup); erros são engolidos
 * para não derrubar o processo. `correlationId` de entrada = id do evento (rastreável, sem efeito).
 */
export async function startBuzzInboxSubscription(
  filter: BuzzSubscriptionFilter = { kinds: [1] },
  tenantId?: string
): Promise<InboxSubscription> {
  if (!isFeatureFlagEnabled("BUZZ_HUB_ENABLED")) {
    return { started: false, stop: async () => {} };
  }
  const adapter = getBuzzAdapter();
  if (!adapter.enabled) return { started: false, stop: async () => {} };

  await adapter.connect();
  await adapter.subscribe(filter, (event) => {
    try {
      // Storage-only: dedup + persiste. NUNCA dispara efeito (Nostr não autoriza).
      receiveInbox(event, event.id, tenantId);
    } catch {
      /* best-effort: um evento malformado não derruba a assinatura */
    }
  });
  return {
    started: true,
    stop: async () => {
      try {
        await adapter.close();
      } catch {
        /* ignore */
      }
    },
  };
}
