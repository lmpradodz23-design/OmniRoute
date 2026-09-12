/**
 * GET /api/buzz — estado do Buzz Hub para o painel único: flag, relay, pubkey do agente e
 * contagens do outbox/inbox. NUNCA expõe a chave secreta. Leitura local (não conecta ao relay).
 *
 * Autenticado (management). Ao contrário do Loop, o status É legível mesmo com a flag OFF —
 * para o painel poder mostrar "desligado" e orientar a ativação. Com a flag OFF a leitura não
 * cria nem persiste a identidade Nostr (auditoria B-L2); com a flag ON a leitura ativa o hub.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  validateBuzzRelayUrl,
  type BuzzRelayUrlErrorCode,
} from "@omniroute/open-sse/buzz-bridge/index.ts";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getBuzzStatus, setBuzzRelayUrl } from "@/lib/buzzService";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

// Body of PUT /api/buzz. Shape validated here (T06 route-validation gate); the URL itself
// goes through validateBuzzRelayUrl (scheme, no credentials, no private/metadata hosts).
const relayBodySchema = z.strictObject({ relayUrl: z.string().max(2048) });

/**
 * Corpo de erro tipado das rotas do Buzz. `error` é uma string (o painel exibe `d.error`
 * diretamente) e `code` é estável para clientes programáticos. Nunca ecoa a URL enviada.
 */
export interface BuzzApiErrorBody {
  error: string;
  code: BuzzRelayUrlErrorCode | "invalid_body";
}

function badRequest(code: BuzzApiErrorBody["code"], error: string): Response {
  const body: BuzzApiErrorBody = { error, code };
  return NextResponse.json(body, { status: 400 });
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  return NextResponse.json(getBuzzStatus());
}

/**
 * PUT /api/buzz — define a URL do relay pelo painel único. Body: { relayUrl: string }.
 *
 * INTENCIONALMENTE não é gated por BUZZ_HUB_ENABLED (diferente de /flush): é configuração
 * (não-secreta, admin-only) que o operador ajusta ANTES de ligar a flag. Nada conecta aqui —
 * a conexão só ocorre no flush/consumidor, que são gated. A URL passa por `validateBuzzRelayUrl`
 * (auditoria B-M2): sem credenciais/query/fragment, metadata sempre bloqueada, hosts privados
 * bloqueados salvo loopback, wss:// obrigatório fora de loopback. String vazia limpa o override.
 */
export async function PUT(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  const validation = validateBody(relayBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return badRequest("invalid_body", "relayUrl (string, max 2048 chars) is required");
  }
  const trimmed = validation.data.relayUrl.trim();
  if (trimmed) {
    const check = validateBuzzRelayUrl(trimmed);
    if (check.ok === false) return badRequest(check.code, check.message);
  }
  setBuzzRelayUrl(trimmed);
  return NextResponse.json(getBuzzStatus());
}
