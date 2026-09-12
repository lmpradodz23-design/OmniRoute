/**
 * db/browserGuard.ts — allowlist de domínios da automação de navegador.
 *
 * Armazenamento: tabela `key_value`, namespace `browser`, chave `allowed_domains`, com o valor
 * serializado como um array JSON de strings — o padrão já usado por `db/ccDiscoveryAliases.ts` e
 * `db/paramFilters.ts`. A consulta vive aqui, e não na rota, porque SQL cru num handler de rota é
 * proibido pela regra de banco do repositório (`tests/unit/check-db-rules.test.ts`).
 *
 * Escrita: `setBrowserAllowedDomains`, chamada por `PUT /api/browser/allowlist` (card
 * "Browser Use domain allowlist" em Settings → Security). Leitura: `getBrowserAllowedDomains`,
 * usada por `GET /api/browser/allowlist` e como fallback de `POST /api/browser/check`.
 *
 * Leitura fail-closed: qualquer coisa que não seja um array JSON de strings vira allowlist vazia,
 * e allowlist vazia nega tudo no `browser-guard`. Um valor corrompido não pode virar `undefined`
 * dentro do motor de política nem abrir a porta por omissão. Entradas guardadas que não passem
 * pela mesma normalização da escrita são descartadas na leitura (nunca "consertadas" para algo
 * mais amplo).
 *
 * Normalização (a mesma na escrita e na leitura): trim, minúsculas, pontos iniciais removidos e
 * um ponto final (FQDN) removido. Rejeitado, com um código estável por entrada:
 *  - `empty` / `too_long` (> 253) — nada a casar, ou não é um hostname DNS;
 *  - `invalid_characters` — esquema, caminho, porta, userinfo, query, espaço ou curinga (`*`):
 *    a allowlist é de HOSTS; `https://a.com/x` ou `a.com:8443` dariam a falsa impressão de que o
 *    guarda restringe caminho/porta, e `*.a.com` é redundante (subdomínios já casam por sufixo);
 *  - `non_ascii` — o guarda compara com `new URL().hostname`, que vem em punycode; um IDN em
 *    Unicode nunca casaria. O operador informa a forma `xn--`;
 *  - `ip_literal` — IPs são recusados: casamento por sufixo não tem sentido para endereços, e uma
 *    allowlist de IP é o atalho mais curto para a automação alcançar rede privada ou o endpoint
 *    de metadata da nuvem (169.254.169.254). Nenhum rótulo final DNS é todo numérico, então um
 *    último rótulo numérico é tratado como IP (cobre também formas curtas como `10.1`);
 *  - `single_label` — `localhost`, `intranet` ou um TLD puro (`com`) liberariam tudo abaixo
 *    deles; exige-se ao menos dois rótulos. Não há verificação de Public Suffix List: `co.uk`
 *    passa, e é responsabilidade do administrador não liberar um sufixo público;
 *  - `invalid_label` — rótulo vazio (`a..b`), > 63 chars, ou fora de `[a-z0-9-]` com hífen nas
 *    pontas.
 * Duplicatas (após normalizar) são colapsadas; o total é limitado a MAX_DOMAINS.
 */

import { getDbInstance } from "./core";

const NAMESPACE = "browser";
const ALLOWED_DOMAINS_KEY = "allowed_domains";

/** Teto defensivo: uma allowlist gigante só serviria para fazer o casamento varrer CPU. */
const MAX_DOMAINS = 256;
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

export const BROWSER_ALLOWLIST_MAX_DOMAINS = MAX_DOMAINS;

export type BrowserDomainRejection =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "non_ascii"
  | "ip_literal"
  | "single_label"
  | "invalid_label";

type DomainCheck =
  { kind: "valid"; domain: string } | { kind: "invalid"; reason: BrowserDomainRejection };

export type BrowserAllowlistWrite =
  | { kind: "saved"; allowedDomains: string[] }
  | { kind: "invalid"; invalid: Array<{ index: number; reason: BrowserDomainRejection }> }
  | { kind: "too_many"; max: number };

// Esquema, caminho, porta, userinfo, query/fragmento, curinga, colchetes de IPv6 e espaços.
const FORBIDDEN_CHARACTERS = /[\s:/\?#@*[\]%]/;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const NUMERIC_LABEL = /^[0-9]+$/;

function strip(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
}

function rejectLabels(labels: string[]): BrowserDomainRejection | null {
  if (labels.length < 2) return "single_label";
  if (NUMERIC_LABEL.test(labels[labels.length - 1])) return "ip_literal";
  const bad = labels.some((l) => l.length > MAX_LABEL_LENGTH || !LABEL_PATTERN.test(l));
  return bad ? "invalid_label" : null;
}

function checkDomain(raw: string): DomainCheck {
  const domain = strip(raw);
  if (!domain) return { kind: "invalid", reason: "empty" };
  if (domain.length > MAX_DOMAIN_LENGTH) return { kind: "invalid", reason: "too_long" };
  if (FORBIDDEN_CHARACTERS.test(domain)) return { kind: "invalid", reason: "invalid_characters" };
  if (/[^\x20-\x7e]/.test(domain)) return { kind: "invalid", reason: "non_ascii" };
  const reason = rejectLabels(domain.split("."));
  return reason ? { kind: "invalid", reason } : { kind: "valid", domain };
}

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
    const domains = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const check = checkDomain(entry);
      if (check.kind === "valid") domains.add(check.domain);
    }
    return [...domains].slice(0, MAX_DOMAINS);
  } catch {
    return [];
  }
}

/**
 * Substitui a allowlist inteira. Tudo ou nada: se QUALQUER entrada for inválida nada é gravado e
 * a resposta lista os índices (da entrada original) com o motivo — o valor enviado não é ecoado.
 * Lista vazia é válida e grava `[]` (nega tudo).
 */
export function setBrowserAllowedDomains(input: readonly string[]): BrowserAllowlistWrite {
  const invalid: Array<{ index: number; reason: BrowserDomainRejection }> = [];
  const domains = new Set<string>();
  input.forEach((raw, index) => {
    const check = checkDomain(raw);
    if (check.kind === "valid") domains.add(check.domain);
    else invalid.push({ index, reason: check.reason });
  });
  if (invalid.length > 0) return { kind: "invalid", invalid };
  if (domains.size > MAX_DOMAINS) return { kind: "too_many", max: MAX_DOMAINS };

  const allowedDomains = [...domains];
  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(NAMESPACE, ALLOWED_DOMAINS_KEY, JSON.stringify(allowedDomains));
  return { kind: "saved", allowedDomains };
}
