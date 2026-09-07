/**
 * Browser Guard — política DETERMINÍSTICA para automação de navegador (Fase 7, "Browser Use").
 *
 * Desligado por padrão. Allowlist de domínio. Efeito externo (enviar form, download, upload,
 * compra) exige aprovação humana. E — crucial contra prompt injection — uma ação cuja ORIGEM é a
 * PÁGINA (texto lido) NUNCA escala permissão: efeitos externos originados na página são negados.
 * O CÓDIGO decide (não a IA). Puro, sem I/O; o driver real (Playwright) fica fora deste módulo.
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
  /** URL alvo (quando aplicável). Usada para checar a allowlist de domínio. */
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
 * Decide uma ação de navegador. Fail-closed:
 * - browser OFF → deny;
 * - URL fora da allowlist → deny;
 * - efeito externo originado na PÁGINA → deny (prompt injection não escala);
 * - efeito externo (origem usuário) → require_approval (humano);
 * - navegação/leitura em domínio permitido → allow.
 */
export function decideBrowserAction(action: BrowserAction, policy: BrowserPolicy): BrowserVerdict {
  if (!policy.enabled) {
    return { decision: "deny", reason: "Browser Use está desligado (padrão)" };
  }

  if (action.url !== undefined) {
    const host = hostOf(action.url);
    if (!host) return { decision: "deny", reason: "URL inválida" };
    if (!domainAllowed(host, policy.allowedDomains)) {
      return { decision: "deny", reason: `domínio fora da allowlist: ${host}` };
    }
  }

  const isExternal = EXTERNAL_EFFECT_KINDS.has(action.kind);

  if (isExternal && action.origin === "page") {
    // Instrução vinda do conteúdo da página tentando um efeito externo → bloqueio absoluto.
    return {
      decision: "deny",
      reason: "efeito externo originado na página (possível prompt injection) — negado",
    };
  }

  if (isExternal) {
    return {
      decision: "require_approval",
      reason: `efeito externo (${action.kind}) requer aprovação humana`,
    };
  }

  // Leitura/navegação/clique/digitação em domínio permitido.
  return { decision: "allow", reason: "ação de leitura/navegação em domínio permitido" };
}
