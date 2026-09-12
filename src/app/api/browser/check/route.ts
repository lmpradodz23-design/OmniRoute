/**
 * POST /api/browser/check — avalia uma ação de navegador pela política determinística.
 * Body: { action: BrowserAction, allowedDomains?: string[] }.
 *
 * Autenticado (management, escopo admin nas mutações) e gated por BROWSER_USE_ENABLED. Se
 * allowedDomains não vier no corpo, usa o override persistido no painel (key_value namespace
 * 'browser'). Efeito externo → aprovação humana; efeito originado na página → deny (prompt
 * injection não escala). Não executa nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getDbInstance } from "@/lib/db/core";
import { traceSync } from "@/lib/otel";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { decideBrowserAction } from "@omniroute/open-sse/browser-guard/index.ts";

/**
 * `origin` é a defesa central deste endpoint contra prompt injection: um efeito externo cuja
 * origem é a PÁGINA é sempre negado. Por isso ele é um enum fechado e não um string livre —
 * um valor inesperado não pode cair no ramo "confiável" por omissão. `strictObject` recusa
 * chaves desconhecidas para que nada contorne a decisão.
 */
const actionSchema = z.strictObject({
  kind: z.enum(["navigate", "read", "click", "type", "submit", "download", "upload", "purchase"]),
  url: z.string().max(2048).optional(),
  origin: z.enum(["user", "page"]),
});

const checkBodySchema = z.strictObject({
  action: actionSchema,
  allowedDomains: z.array(z.string().min(1).max(253)).max(256).optional(),
});

function storedAllowlist(): string[] {
  try {
    const row = getDbInstance()
      .prepare(
        "SELECT value FROM key_value WHERE namespace = 'browser' AND key = 'allowed_domains'"
      )
      .get() as { value: string } | undefined;
    if (!row?.value) return [];
    const parsed: unknown = JSON.parse(row.value);
    // O valor persistido é dado, não contrato: se alguém gravou outra forma, a allowlist vira
    // vazia (fail-closed) em vez de virar `undefined` dentro do motor de política.
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("BROWSER_USE_ENABLED")) {
    return NextResponse.json(
      { error: "Browser Use is disabled. Enable BROWSER_USE_ENABLED in the OmniRoute panel." },
      { status: 404 }
    );
  }

  const validation = validateBody(checkBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return NextResponse.json(
      { error: "action {kind, origin: 'user'|'page', url?} is required" },
      { status: 400 }
    );
  }

  const { action, allowedDomains: fromBody } = validation.data;
  const allowedDomains = fromBody ?? storedAllowlist();

  const verdict = traceSync(
    "browser.check",
    { route: "/api/browser/check", "http.method": "POST" },
    () => decideBrowserAction(action, { enabled: true, allowedDomains })
  );
  return NextResponse.json({ verdict, allowedDomains });
}
