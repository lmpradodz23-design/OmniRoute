/**
 * Buzz Producer — liga o Loop Engine ao outbox do Buzz (fecha o gap "sem produtor de produção").
 *
 * Quando um run do Loop precisa de um humano (awaiting_approval) ou escala (escalated), enfileira
 * uma notificação DURÁVEL no outbox do Buzz. Idempotente (id derivado do run+status+seq), aditivo e
 * best-effort: uma falha do Buzz NUNCA quebra o Loop. Nada conecta aqui — a publicação real fica no
 * flush (gated por BUZZ_HUB_ENABLED). A chave Nostr nunca autoriza ação; isto é só sinalização.
 *
 * Enfileirar NÃO cria a identidade Nostr do agente (auditoria B-L2): o `pubkey` gravado é o da
 * identidade existente ou vazio — a publicação RE-ASSINA o evento com a chave do agente, logo a
 * autoria de saída é atribuída no publish, não aqui.
 */
import type { BuzzEvent } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { enqueueOutbox } from "./db/buzzBridge";
import { getAgentPubkey } from "./buzzService";

export interface LoopNotice {
  runId: string;
  status: string;
  pattern: string;
  sequenceNumber: number;
  tenantId?: string;
}

/** Pubkey existente do agente, sem criar identidade nem propagar erro de decifragem. */
function existingAgentPubkey(): string {
  try {
    return getAgentPubkey() ?? "";
  } catch {
    return "";
  }
}

/**
 * Enfileira uma notificação do Loop no outbox (report-only). Retorna true se enfileirou.
 * Best-effort: engole erros (ex.: tabelas ausentes num DB mínimo) para não afetar o run.
 */
export function notifyLoopEvent(notice: LoopNotice): boolean {
  try {
    const event: BuzzEvent = {
      // id estável → dedup no enqueue (mesma transição não vira dois eventos).
      id: `loop:${notice.runId}:${notice.status}:${notice.sequenceNumber}`,
      pubkey: existingAgentPubkey(),
      kind: 1,
      createdAt: 0, // o enqueue carimba um createdAt estável
      tags: [
        ["t", "loop"],
        ["run", notice.runId],
        ["status", notice.status],
      ],
      content: `Loop "${notice.pattern}" (${notice.runId}) → ${notice.status}`,
    };
    enqueueOutbox({
      event,
      correlationId: `loop:${notice.runId}`,
      runId: notice.runId,
      tenantId: notice.tenantId,
    });
    return true;
  } catch {
    return false;
  }
}

/** Estados do Loop que merecem um aviso ao humano (aprovação/handoff). */
export function loopStatusNeedsHuman(status: string): boolean {
  return status === "awaiting_approval" || status === "escalated";
}
