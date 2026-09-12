/**
 * Browser Guard — política DETERMINÍSTICA para automação de navegador (Fase 7, "Browser Use").
 *
 * Desligado por padrão. Allowlist de domínio. Efeito externo (enviar form, download, upload,
 * compra) exige aprovação humana. E — crucial contra prompt injection — uma ação cuja ORIGEM é a
 * PÁGINA (texto lido) NUNCA escala permissão. O CÓDIGO decide (não a IA). Puro, sem I/O; o driver
 * real (Playwright) fica fora deste módulo.
 *
 * A regra de origem é enunciada por EFEITO, não por rótulo. A primeira versão classificava só
 * pelo `kind` declarado, e `click`/`type` não estavam na lista de efeitos externos: clicar num
 * botão "Confirmar compra" ou num link de download era um `click`, e passava como leitura. Uma
 * página injetada que induzisse um clique escalava sem aprovação humana — exatamente o que este
 * módulo promete impedir. Agora só `read` é permitido quando a origem é a página; qualquer outra
 * coisa que o conteúdo da página peça é negada, porque o guarda não tem como saber o que há do
 * outro lado de um clique.
 */

export type BrowserActionKind =
  | "navigate"
  | "read"
  | "click"
  | "type"
  | "submit" // enviar formulário
  | "download"
  | "upload"
  | "purchase";

/** Origem da intenção: o usuário/agente (confiável) ou conteúdo lido da página (NÃO confiável). */
export type BrowserActionOrigin = "user" | "page";

export interface BrowserAction {
  readonly kind: BrowserActionKind;
  /** URL alvo. Obrigatória em toda ação que alcança a rede (ver NETWORK_REACHING_KINDS). */
  readonly url?: string;
  readonly origin: BrowserActionOrigin;
}

export interface BrowserPolicy {
  /** Browser Use está ligado? Padrão do produto: OFF. */
  readonly enabled: boolean;
  /** Domínios permitidos (host exato ou sufixo, ex.: "example.com"). Vazio = nada permitido. */
  readonly allowedDomains: ReadonlyArray<string>;
}

export type BrowserDecision = "allow" | "require_approval" | "deny";

export interface BrowserVerdict {
  readonly decision: BrowserDecision;
  readonly reason: string;
}

/** Ações com efeito externo — nunca automáticas: exigem humano (e nunca se originam da página). */
export const EXTERNAL_EFFECT_KINDS: ReadonlySet<BrowserActionKind> = new Set([
  "submit",
  "download",
  "upload",
  "purchase",
]);

/**
 * Ações que alcançam a rede e portanto PRECISAM de `url` para serem julgadas contra a allowlist.
 * Sem URL não há host, sem host não há como decidir — e "não dá para decidir" tem que virar deny,
 * não allow. A versão anterior pulava a checagem inteira quando `url` era omitida, de modo que
 * `{kind:"click", origin:"page"}` sem URL passava mesmo com a allowlist vazia.
 */
export const NETWORK_REACHING_KINDS: ReadonlySet<BrowserActionKind> = new Set([
  "navigate",
  "read",
  "click",
  "submit",
  "download",
  "upload",
  "purchase",
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** host casa a allowlist se for igual ou subdomínio de algum domínio permitido. */
function domainAllowed(host: string, allowed: ReadonlyArray<string>): boolean {
  return allowed.some((d) => {
    const dom = d.toLowerCase().replace(/^\.+/, "");
    return host === dom || host.endsWith("." + dom);
  });
}

/**
 * Decide uma ação de navegador. Fail-closed, na ordem:
 * - browser OFF → deny;
 * - origem PÁGINA e a ação não é `read` → deny (prompt injection não escala);
 * - ação alcança a rede sem `url` → deny (sem host não há julgamento possível);
 * - URL presente e inválida, ou host fora da allowlist → deny;
 * - efeito externo (origem usuário) → require_approval (humano);
 * - leitura/navegação/digitação em domínio permitido → allow.
 */
export function decideBrowserAction(action: BrowserAction, policy: BrowserPolicy): BrowserVerdict {
  if (!policy.enabled) {
    return { decision: "deny", reason: "Browser Use está desligado (padrão)" };
  }

  // Conteúdo lido da página só pode pedir mais leitura. Qualquer outra coisa — clicar, digitar,
  // navegar, enviar — é negada antes de olhar allowlist ou tipo de efeito, porque o guarda não
  // sabe o que um clique dispara do outro lado.
  if (action.origin === "page" && action.kind !== "read") {
    return {
      decision: "deny",
      reason: `ação '${action.kind}' originada na página (possível prompt injection) — negada`,
    };
  }

  if (NETWORK_REACHING_KINDS.has(action.kind)) {
    if (action.url === undefined) {
      return { decision: "deny", reason: `ação '${action.kind}' exige url para ser julgada` };
    }
    const host = hostOf(action.url);
    if (!host) return { decision: "deny", reason: "URL inválida" };
    if (!domainAllowed(host, policy.allowedDomains)) {
      return { decision: "deny", reason: `domínio fora da allowlist: ${host}` };
    }
  } else if (action.url !== undefined) {
    // `type` não alcança a rede, mas se o chamador informou um alvo ele também é julgado.
    const host = hostOf(action.url);
    if (!host) return { decision: "deny", reason: "URL inválida" };
    if (!domainAllowed(host, policy.allowedDomains)) {
      return { decision: "deny", reason: `domínio fora da allowlist: ${host}` };
    }
  }

  if (EXTERNAL_EFFECT_KINDS.has(action.kind)) {
    return {
      decision: "require_approval",
      reason: `efeito externo (${action.kind}) requer aprovação humana`,
    };
  }

  return { decision: "allow", reason: "ação de leitura/navegação em domínio permitido" };
}
