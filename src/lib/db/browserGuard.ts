/**
 * db/browserGuard.ts — allowlist de domínios da automação de navegador.
 *
 * Armazenamento: tabela `key_value`, namespace `browser`, chave `allowed_domains`, com o valor
 * serializado como um array JSON de strings — o padrão já usado por `db/ccDiscoveryAliases.ts` e
 * `db/paramFilters.ts`. A consulta vive aqui, e não na rota, porque SQL cru num handler de rota é
 * proibido pela regra de banco do repositório (`tests/unit/check-db-rules.test.ts`).
 *
 * Leitura fail-closed: qualquer coisa que não seja um array JSON de strings vira allowlist vazia,
 * e allowlist vazia nega tudo no `browser-guard`. Um valor corrompido não pode virar `undefined`
 * dentro do motor de política nem abrir a porta por omissão.
 *
 * NOTA HONESTA: nada no repositório ESCREVE esta chave ainda — não há tela nem endpoint que
 * configure a allowlist persistida, então na prática ela é sempre vazia e quem chama
 * `POST /api/browser/check` precisa passar `allowedDomains` no corpo. Este módulo deliberadamente
 * NÃO exporta um escritor especulativo: um export sem chamador é código morto, e a tela de
 * configuração, quando existir, traz o seu próprio ponto de escrita junto com o caso de uso.
 */

import { getDbInstance } from "./core";

const NAMESPACE = "browser";
const ALLOWED_DOMAINS_KEY = "allowed_domains";

/** Teto defensivo: uma allowlist gigante só serviria para fazer o casamento varrer CPU. */
const MAX_DOMAINS = 256;

/**
 * Domínios permitidos persistidos. Retorna `[]` quando não há linha, quando o JSON é inválido ou
 * quando o valor não é um array de strings — todos os caminhos convergem para "nada permitido".
 */
export function getBrowserAllowedDomains(): string[] {
  try {
    const row = getDbInstance()
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get(NAMESPACE, ALLOWED_DOMAINS_KEY) as { value?: string } | undefined;
    if (!row?.value) return [];
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === "string").slice(0, MAX_DOMAINS);
  } catch {
    return [];
  }
}
