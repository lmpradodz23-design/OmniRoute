/**
 * POST /api/buzz/flush — publica as entradas elegíveis do outbox no relay real (idempotente,
 * com retry/backoff persistido e teto de tempo). Gated por BUZZ_HUB_ENABLED: com a flag OFF
 * retorna { skipped: true } sem conectar; sem relay configurado idem.
 *
 * Serve ao painel único (botão "Publicar pendentes") e a qualquer harness/automação.
 *
 * Erros de relay (auditoria B-M4): o cliente recebe um corpo genérico e tipado — nunca a mensagem
 * crua (`connect ECONNREFUSED host:porta`), que identificaria o relay. O detalhe vai só ao log,
 * redigido (código/nome do erro, sem host).
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { describeRelayError, flushBuzzOutbox } from "@/lib/buzzService";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

interface BuzzFlushErrorBody {
  error: string;
  code: "relay_unavailable";
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("BUZZ_HUB_ENABLED")) {
    return NextResponse.json(
      { published: 0, failed: 0, skipped: true, reason: "BUZZ_HUB_ENABLED is off" },
      { status: 200 }
    );
  }
  try {
    const result = await flushBuzzOutbox();
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[BUZZ] flush failed: relay unavailable:", describeRelayError(err));
    const body: BuzzFlushErrorBody = {
      error: "Buzz relay unavailable: the outbox could not be published; it stays pending",
      code: "relay_unavailable",
    };
    return NextResponse.json(body, { status: 502 });
  }
}
