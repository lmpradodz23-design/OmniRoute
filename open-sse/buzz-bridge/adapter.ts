/**
 * Buzz Bridge — adaptador desabilitado.
 *
 * Enquanto a flag `buzz_hub` estiver OFF (ou nenhum relay válido estiver configurado), usamos o
 * DisabledBuzzAdapter: ele NÃO conecta e NÃO publica — só reporta que está inerte. As
 * entradas ficam no outbox até haver relay + flag ON e o WebSocketBuzzAdapter assumir.
 */
import type { BuzzAdapter, BuzzEvent, BuzzSubscriptionFilter, OutboxEntry } from "./types.ts";

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
