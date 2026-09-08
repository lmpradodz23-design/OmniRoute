/**
 * MCP Review Gate — pipeline de segurança DETERMINÍSTICO para servidores/pacotes MCP.
 *
 * Deriva da Fase 6 do plano (MCP Marketplace): descobrir → quarentena → verificar → revisar →
 * aprovar → instalar → habilitar. O CÓDIGO decide (não a IA), fail-closed: pacote malicioso é
 * negado; qualquer novidade ou AMPLIAÇÃO de permissão volta a REVIEW_REQUIRED (aprovação humana).
 * Puro (sem I/O). O instalador real (checksum/download) fica no marketplace do OmniRoute.
 */

/** Estados do ciclo de revisão de um servidor MCP. */
export type McpReviewState =
  | "discovered" // encontrado no registry (read-only)
  | "quarantined" // isolado até verificação
  | "verified" // integridade/assinatura conferidas
  | "review_required" // aguarda aprovação humana (novo ou permissão ampliada)
  | "approved" // liberado para instalar/habilitar
  | "denied"; // bloqueado (malicioso/forbidden)

/** Um candidato do registry. Permissões são capabilities declaradas (ex.: "fs:read", "net:fetch"). */
export interface McpCandidate {
  readonly name: string;
  readonly source: string; // origem (registry/url)
  readonly version: string;
  readonly permissions: ReadonlyArray<string>;
  /** Assinatura/publisher conferidos por processo externo (verify). */
  readonly publisherVerified?: boolean;
  /** Marcado como malicioso por um scanner externo (hash conhecido, etc.). */
  readonly flaggedMalicious?: boolean;
}

/** Estado prévio conhecido do MESMO servidor (para detectar ampliação de permissão em updates). */
export interface McpPriorApproval {
  readonly version: string;
  readonly permissions: ReadonlyArray<string>;
  readonly approved: boolean;
}

export interface McpReviewVerdict {
  readonly state: McpReviewState;
  readonly requiresHumanApproval: boolean;
  readonly reasons: string[];
  /** Permissões novas em relação ao prior (vazio quando não amplia). */
  readonly newlyRequested: string[];
}

/**
 * Permissões que, sozinhas, NUNCA se auto-aprovam — sempre exigem revisão humana explícita.
 * (efeitos amplos/perigosos). Não são "proibidas", mas nunca passam sem gate humano.
 */
export const SENSITIVE_MCP_PERMISSIONS: ReadonlySet<string> = new Set([
  "fs:write",
  "fs:delete",
  "shell:exec",
  "process:spawn",
  "net:listen",
  "secrets:read",
]);

/**
 * Capabilities PROIBIDAS: presença → denied (bloqueio, como "pacote malicioso"). Um MCP não deve
 * jamais pedir exfiltração de credenciais ou billing.
 */
export const FORBIDDEN_MCP_PERMISSIONS: ReadonlySet<string> = new Set([
  "secrets:exfiltrate",
  "billing:write",
  "keys:read",
]);

function broadenedPermissions(
  candidate: ReadonlyArray<string>,
  prior: ReadonlyArray<string>
): string[] {
  const priorSet = new Set(prior);
  return candidate.filter((p) => !priorSet.has(p));
}

/**
 * Decide o próximo estado de revisão para um candidato MCP. Determinístico e fail-closed:
 * - malicioso ou permissão proibida → denied.
 * - novo (sem prior) → review_required.
 * - update que AMPLIA permissões → review_required (re-revisão).
 * - permissão sensível presente e ainda não aprovada para ela → review_required.
 * - update sem ampliação, com prior aprovado → approved (carrega a aprovação).
 */
export function reviewMcpCandidate(
  candidate: McpCandidate,
  prior?: McpPriorApproval
): McpReviewVerdict {
  const reasons: string[] = [];

  if (candidate.flaggedMalicious) {
    return {
      state: "denied",
      requiresHumanApproval: false,
      reasons: ["marcado como malicioso por scanner externo"],
      newlyRequested: [],
    };
  }

  const forbidden = candidate.permissions.filter((p) => FORBIDDEN_MCP_PERMISSIONS.has(p));
  if (forbidden.length > 0) {
    return {
      state: "denied",
      requiresHumanApproval: false,
      reasons: [`permissões proibidas: ${forbidden.join(", ")}`],
      newlyRequested: [],
    };
  }

  const newlyRequested = prior
    ? broadenedPermissions(candidate.permissions, prior.permissions)
    : [...candidate.permissions];

  const hasSensitive = candidate.permissions.some((p) => SENSITIVE_MCP_PERMISSIONS.has(p));

  // Novo servidor: sempre revisão humana.
  if (!prior) {
    reasons.push("servidor novo — requer revisão humana");
    if (hasSensitive) reasons.push("declara permissões sensíveis");
    return { state: "review_required", requiresHumanApproval: true, reasons, newlyRequested };
  }

  // Update que amplia permissões → volta para revisão (mesmo que antes aprovado).
  if (newlyRequested.length > 0) {
    reasons.push(`amplia permissões: ${newlyRequested.join(", ")} — re-revisão obrigatória`);
    return { state: "review_required", requiresHumanApproval: true, reasons, newlyRequested };
  }

  // Sem ampliação: carrega a aprovação anterior — MAS fail-closed no publisher: se a verificação
  // externa REPROVOU o publisher (publisherVerified === false), volta à revisão mesmo sem ampliar
  // (assinatura/publisher divergente é sinal de comprometimento, não um simples patch).
  if (prior.approved) {
    if (candidate.publisherVerified === false) {
      reasons.push("publisher não verificado — re-revisão obrigatória apesar de não ampliar");
      return { state: "review_required", requiresHumanApproval: true, reasons, newlyRequested: [] };
    }
    reasons.push("update sem novas permissões — aprovação anterior mantida");
    return { state: "approved", requiresHumanApproval: false, reasons, newlyRequested: [] };
  }

  reasons.push("sem aprovação anterior — requer revisão humana");
  return { state: "review_required", requiresHumanApproval: true, reasons, newlyRequested: [] };
}
