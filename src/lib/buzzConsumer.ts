/**
 * Buzz Consumer — liga o relay ao inbox do OmniRoute (fecha o gap "sem consumidor de produção").
 *
 * Assina o relay (flag ON) e roteia cada evento recebido para `receiveInbox` — que apenas
 * DEDUPLICA e ARMAZENA. NÃO há caminho daqui para qualquer efeito no OmniRoute: uma chave/assinatura
 * Nostr nunca autoriza uma ação (as decisões ficam com o Policy Engine, fora deste módulo). Inbound
 * é só sinal/colaboração para humanos verem no painel. Opt-in e best-effort.
 *
 * Wiring (auditoria A-H2): `initBuzzInboxConsumer` é chamado no boot (src/instrumentation-node.ts).
 * Registra o hook de shutdown SEMPRE; só conecta com BUZZ_HUB_ENABLED ON e relay válido; reconecta
 * com backoff exponencial quando a conexão cai; nunca derruba o boot (log redigido + continua).
 */
import type { BuzzSubscriptionFilter } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { describeRelayError, getBuzzAdapter, getBuzzRelayUrl } from "./buzzService";
import { receiveInbox } from "./db/buzzBridge";
import { registerShutdownHook } from "./shutdownHooks";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export interface InboxSubscription {
  started: boolean;
  /** Encerra a assinatura e fecha a conexão. */
  stop: () => Promise<void>;
}

export interface BuzzConsumerOptions {
  filter?: BuzzSubscriptionFilter;
  tenantId?: string;
  /** Backoff inicial de reconexão (ms). Default 1000. */
  reconnectBaseMs?: number;
  /** Teto do backoff de reconexão (ms). Default 60000. */
  reconnectMaxMs?: number;
}

const SHUTDOWN_HOOK_NAME = "buzz-inbox";
const DEFAULT_FILTER: BuzzSubscriptionFilter = { kinds: [1] };
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 60_000;

const NOT_STARTED: InboxSubscription = { started: false, stop: async () => {} };

/**
 * Inicia UMA assinatura do inbox. Retorna { started:false } quando a flag BUZZ_HUB_ENABLED está OFF
 * ou não há relay válido (nada conecta). Cada evento verificado é persistido via receiveInbox
 * (dedup); erros de persistência são engolidos para não derrubar a assinatura. `onClose` avisa o
 * chamador quando a conexão cai (para reconectar).
 */
export async function startBuzzInboxSubscription(
  filter: BuzzSubscriptionFilter = DEFAULT_FILTER,
  tenantId?: string,
  hooks: { onClose?: () => void } = {}
): Promise<InboxSubscription> {
  if (!isFeatureFlagEnabled("BUZZ_HUB_ENABLED")) return NOT_STARTED;
  const adapter = getBuzzAdapter({ onClose: () => hooks.onClose?.() });
  if (!adapter.enabled) return NOT_STARTED;

  await adapter.connect();
  await adapter.subscribe(filter, (event) => {
    try {
      // Storage-only: dedup + persiste. NUNCA dispara efeito (Nostr não autoriza).
      receiveInbox(event, event.id, tenantId);
    } catch {
      /* best-effort: um evento que não persiste não derruba a assinatura */
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

interface ConsumerState {
  stopping: boolean;
  subscription: InboxSubscription | null;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  options: Required<Pick<BuzzConsumerOptions, "filter" | "reconnectBaseMs" | "reconnectMaxMs">> &
    Pick<BuzzConsumerOptions, "tenantId">;
}

const state: ConsumerState = {
  stopping: true,
  subscription: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  options: {
    filter: DEFAULT_FILTER,
    reconnectBaseMs: DEFAULT_RECONNECT_BASE_MS,
    reconnectMaxMs: DEFAULT_RECONNECT_MAX_MS,
  },
};

function reconnectDelayMs(attempt: number): number {
  const { reconnectBaseMs, reconnectMaxMs } = state.options;
  const exponential = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** Math.min(attempt - 1, 20));
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

function scheduleReconnect(): void {
  if (state.stopping || state.reconnectTimer) return;
  state.reconnectAttempt += 1;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void connectOnce();
  }, reconnectDelayMs(state.reconnectAttempt));
  state.reconnectTimer.unref?.();
}

async function connectOnce(): Promise<void> {
  if (state.stopping || state.subscription) return;
  try {
    const subscription = await startBuzzInboxSubscription(
      state.options.filter,
      state.options.tenantId,
      {
        onClose: () => {
          if (state.subscription) {
            state.subscription = null;
            console.warn("[BUZZ] inbox subscription dropped; reconnecting with backoff");
            scheduleReconnect();
          }
        },
      }
    );
    if (state.stopping) {
      await subscription.stop();
      return;
    }
    if (!subscription.started) return; // flag/relay desligados entretanto: fica ocioso
    state.subscription = subscription;
    state.reconnectAttempt = 0;
    console.log("[BUZZ] inbox subscription connected");
  } catch (err) {
    console.warn(
      "[BUZZ] inbox subscription failed (will retry with backoff):",
      describeRelayError(err)
    );
    scheduleReconnect();
  }
}

/**
 * Arma o consumidor no boot. Registra o hook de shutdown SEMPRE (idempotente por nome); retorna
 * true quando começou a conectar (flag ON + relay válido), false quando ficou inerte. Nunca lança:
 * um relay fora do ar vira reconexão em background com log redigido.
 */
export function initBuzzInboxConsumer(options: BuzzConsumerOptions = {}): boolean {
  registerShutdownHook(SHUTDOWN_HOOK_NAME, stopBuzzInboxConsumer);
  try {
    if (!isFeatureFlagEnabled("BUZZ_HUB_ENABLED")) return false;
    if (!getBuzzRelayUrl()) {
      console.log("[BUZZ] inbox consumer idle: no relay configured (BUZZ_RELAY_URL / dashboard)");
      return false;
    }
    state.options = {
      filter: options.filter ?? DEFAULT_FILTER,
      tenantId: options.tenantId,
      reconnectBaseMs: options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
    };
    state.stopping = false;
    state.reconnectAttempt = 0;
    void connectOnce();
    return true;
  } catch (err) {
    console.warn("[BUZZ] inbox consumer could not be armed:", describeRelayError(err));
    return false;
  }
}

/** Encerra a assinatura ativa, cancela reconexões pendentes e fecha o socket. Idempotente. */
export async function stopBuzzInboxConsumer(): Promise<void> {
  state.stopping = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  const subscription = state.subscription;
  state.subscription = null;
  if (subscription) await subscription.stop();
}

/** true enquanto há uma assinatura conectada ao relay. */
export function isBuzzInboxConsumerRunning(): boolean {
  return state.subscription !== null;
}
