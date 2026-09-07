/**
 * GET /api/buzz — estado do Buzz Hub para o painel único: flag, relay, pubkey do agente e
 * contagens do outbox/inbox. NUNCA expõe a chave secreta. Leitura local (não conecta ao relay).
 *
 * Autenticado (management). Ao contrário do Loop, o status É legível mesmo com a flag OFF —
 * para o painel poder mostrar "desligado" e orientar a ativação. Nada conecta enquanto OFF.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getBuzzStatus, setBuzzRelayUrl } from "@/lib/buzzService";

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  return NextResponse.json(getBuzzStatus());
}

/** PUT /api/buzz — define a URL do relay pelo painel único. Body: { relayUrl: string }. */
export async function PUT(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  const body = (await req.json().catch(() => ({}))) as { relayUrl?: unknown };
  if (typeof body.relayUrl !== "string") {
    return NextResponse.json({ error: "relayUrl (string) is required" }, { status: 400 });
  }
  const trimmed = body.relayUrl.trim();
  // Aceita ws:// ou wss:// (ou vazio para limpar o override). Evita URLs inválidas no relay.
  if (trimmed && !/^wss?:\/\//i.test(trimmed)) {
    return NextResponse.json(
      { error: "relayUrl must start with ws:// or wss://" },
      { status: 400 }
    );
  }
  setBuzzRelayUrl(trimmed);
  return NextResponse.json(getBuzzStatus());
}
