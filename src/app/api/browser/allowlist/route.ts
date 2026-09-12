/**
 * GET /api/browser/allowlist — allowlist de domínios persistida da automação de navegador,
 * mais o estado da flag BROWSER_USE_ENABLED e o teto de entradas (para o painel).
 * PUT /api/browser/allowlist — substitui a allowlist inteira. Body: { allowedDomains: string[] }.
 *
 * Autenticado (management); no caminho de access token o PUT exige escopo `admin`
 * (`/api/browser/allowlist` está em ADMIN_MUTATION_PREFIXES) e o GET fica `read`.
 *
 * INTENCIONALMENTE não é gated por BROWSER_USE_ENABLED — mesmo precedente de `PUT /api/buzz`:
 * é configuração não-secreta que o operador prepara ANTES de ligar a flag, e nada executa aqui.
 * Quem decide ações (`POST /api/browser/check`) continua gated; com a flag OFF tudo é negado de
 * qualquer forma. A resposta traz `enabled` para o painel avisar que a lista ainda não tem efeito.
 *
 * Validação: forma pelo `strictObject` (chave desconhecida → 400); cada domínio pela
 * normalização de `db/browserGuard.ts` (sem esquema/caminho/porta/curinga/IP, ≥ 2 rótulos).
 * Erro de domínio devolve só índice + motivo, nunca ecoa o valor; erro interno nunca ecoa
 * `err.message`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  BROWSER_ALLOWLIST_MAX_DOMAINS,
  getBrowserAllowedDomains,
  setBrowserAllowedDomains,
} from "@/lib/db/browserGuard";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

/** Teto por string antes da normalização (trim/pontos iniciais): folga sobre os 253 do DNS. */
const MAX_RAW_DOMAIN_LENGTH = 300;

const allowlistBodySchema = z.strictObject({
  allowedDomains: z.array(z.string().max(MAX_RAW_DOMAIN_LENGTH)).max(BROWSER_ALLOWLIST_MAX_DOMAINS),
});

function allowlistState(allowedDomains: string[]) {
  return {
    allowedDomains,
    enabled: isFeatureFlagEnabled("BROWSER_USE_ENABLED"),
    maxDomains: BROWSER_ALLOWLIST_MAX_DOMAINS,
  };
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  return NextResponse.json(allowlistState(getBrowserAllowedDomains()));
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;

  const validation = validateBody(allowlistBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return NextResponse.json(
      {
        error: `allowedDomains (array of at most ${BROWSER_ALLOWLIST_MAX_DOMAINS} strings) is required`,
        code: "invalid_body",
      },
      { status: 400 }
    );
  }

  let result: ReturnType<typeof setBrowserAllowedDomains>;
  try {
    result = setBrowserAllowedDomains(validation.data.allowedDomains);
  } catch {
    return createErrorResponse({ status: 500, message: "Could not save the browser allowlist" });
  }
  if (result.kind === "invalid") {
    return NextResponse.json(
      {
        error: "One or more domains are invalid",
        code: "invalid_domains",
        invalid: result.invalid,
      },
      { status: 400 }
    );
  }
  if (result.kind === "too_many") {
    return NextResponse.json(
      { error: `At most ${result.max} domains are allowed`, code: "too_many_domains" },
      { status: 400 }
    );
  }
  return NextResponse.json(allowlistState(result.allowedDomains));
}
