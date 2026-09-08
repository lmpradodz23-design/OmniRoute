/**
 * POST /api/buzz/flush — publica as entradas pendentes do outbox no relay real (idempotente).
 * Gated por BUZZ_HUB_ENABLED: com a flag OFF retorna { skipped: true } sem conectar.
 *
 * Serve ao painel único (botão "Publicar pendentes") e a qualquer harness/automação.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { flushBuzzOutbox } from "@/lib/buzzService";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

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
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "flush failed" },
      { status: 502 }
    );
  }
}
