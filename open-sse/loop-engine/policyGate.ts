/**
 * Loop Engine — Policy Gate (determinístico; código clássico decide, não a IA).
 *
 * Regra central do plano: "Loop Engine começa em modo report-only. Ele PROPÕE; o Policy
 * Engine e as aprovações do OmniRoute DECIDEM. Nenhum loop envia mensagem, publica,
 * exclui, faz merge, deploy, compras ou muda conta sem a aprovação exigida."
 *
 * Este gate NUNCA executa o efeito — só classifica. A execução (quando aprovada) é feita
 * pelos conectores do OmniRoute, fora deste módulo.
 */
import type { LoopProposedEffect, PolicyDecision } from "./types.ts";

/** Efeitos que são SEMPRE proibidos de forma autônoma (exigem humano), mesmo fora de report-only. */
const ALWAYS_REQUIRE_APPROVAL = new Set<LoopProposedEffect["kind"]>([
  "message_send",
  "git_pr",
  "deploy",
  "purchase",
  "account_change",
  "delete",
]);

/** Efeitos irreversíveis/destrutivos que, por padrão, são NEGADos ao loop (só humano faz). */
const AUTONOMY_DENIED = new Set<LoopProposedEffect["kind"]>([
  "purchase",
  "account_change",
  "delete",
]);

export interface PolicyContext {
  /** Modo do run. Em report-only nada externo é auto-aprovado. */
  readonly reportOnly: boolean;
  /** Allowlist opcional de kinds que o operador liberou para auto-execução (nunca inclui os AUTONOMY_DENIED). */
  readonly autoApproveKinds?: ReadonlyArray<LoopProposedEffect["kind"]>;
}

/**
 * Decide o destino de um efeito proposto. Determinístico e fail-closed:
 * - efeito "none" → allow (inócuo);
 * - kinds destrutivos → deny (autonomia proibida);
 * - report-only OU kind sensível → require_approval;
 * - só libera "allow" se o operador incluiu explicitamente o kind na allowlist e não é destrutivo.
 */
export function decideEffect(
  effect: LoopProposedEffect | undefined,
  ctx: PolicyContext
): PolicyDecision {
  if (!effect || effect.kind === "none") return { outcome: "allow" };

  if (AUTONOMY_DENIED.has(effect.kind)) {
    return {
      outcome: "deny",
      reason: `Efeito '${effect.kind}' nunca é autônomo: exige ação humana explícita.`,
    };
  }

  if (ctx.reportOnly) {
    return {
      outcome: "require_approval",
      reason: "Run em modo report-only: todo efeito externo aguarda aprovação.",
    };
  }

  if (ALWAYS_REQUIRE_APPROVAL.has(effect.kind)) {
    const allowed = ctx.autoApproveKinds?.includes(effect.kind) ?? false;
    if (!allowed) {
      return {
        outcome: "require_approval",
        reason: `Efeito '${effect.kind}' exige aprovação (não está na allowlist do operador).`,
      };
    }
  }

  // Chegou aqui: kind não-destrutivo, fora de report-only, e liberado pelo operador.
  return { outcome: "allow" };
}

/** true se o efeito pode ser executado sem parar para humano, sob o contexto dado. */
export function isAutoExecutable(
  effect: LoopProposedEffect | undefined,
  ctx: PolicyContext
): boolean {
  return decideEffect(effect, ctx).outcome === "allow";
}
