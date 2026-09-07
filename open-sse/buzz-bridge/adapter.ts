/**
 * Buzz Bridge — adaptador desabilitado + guarda de autorização.
 *
 * Enquanto a flag `buzz_hub` estiver OFF (ou o relay não estiver rodando), usamos o
 * DisabledBuzzAdapter: ele NÃO conecta e NÃO publica — só reporta que está inerte. As
 * entradas ficam no outbox até haver relay + flag ON e o WebSocketBuzzAdapter (futuro).
 */
import type {
  BuzzAdapter,
  BuzzEvent,
  BuzzIdentityMapping,
  BuzzSubscriptionFilter,
  OutboxEntry,
} from "./types.ts";

export class DisabledBuzzAdapter implements BuzzAdapter {
  readonly enabled = false;
  async connect(): Promise<void> {
    /* inerte: sem relay, sem conexão */
  }
  async publish(_entry: OutboxEntry): Promise<boolean> {
    return false; // nada é publicado enquanto desabilitado
  }
  async subscribe(
    _filter: BuzzSubscriptionFilter,
    _onEvent: (e: BuzzEvent) => void
  ): Promise<void> {
    /* inerte */
  }
  async close(): Promise<void> {
    /* inerte */
  }
}

/**
 * Regra de segurança inegociável: uma chave Nostr (buzz_pubkey) NUNCA autoriza, por si só,
 * uma ação no OmniRoute. A autorização real vem SEMPRE das políticas/aprovações do OmniRoute
 * para o (tenant, workspace, user/agent) mapeado — nunca do fato de o evento estar assinado.
 *
 * Esta função é deliberadamente fail-closed: ela apenas confirma que existe um mapeamento
 * de identidade; a decisão de permitir o efeito é do Policy Engine, fora daqui.
 */
export function buzzIdentityIsMapped(
  mapping: BuzzIdentityMapping | undefined,
  buzzPubkey: string
): boolean {
  if (!mapping) return false;
  if (!mapping.buzzPubkey || mapping.buzzPubkey !== buzzPubkey) return false;
  return Boolean(mapping.tenantId && mapping.workspaceId);
}

/** Uma chave Nostr, sozinha, jamais autoriza. Documenta a regra em código executável. */
export function nostrKeyAuthorizes(): false {
  return false;
}
