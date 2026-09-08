/**
 * GET /api/otel/spans — lê os spans recentes coletados (W3C Trace Context), sem conteúdo sensível.
 *
 * Autenticado (management) e gated por OTEL_TRACING_ENABLED. Os atributos já passaram pela allowlist
 * do core (nada de prompt/resposta/PII/segredo). Útil para inspecionar latência/rota/provider.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { recentSpans } from "@/lib/otel";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("OTEL_TRACING_ENABLED")) {
    return NextResponse.json(
      { error: "OTel tracing is disabled. Enable OTEL_TRACING_ENABLED in the OmniRoute panel." },
      { status: 404 }
    );
  }
  const raw = new URL(req.url).searchParams.get("limit");
  const limit = Math.min(Math.max(Number(raw) || 100, 1), 500);
  return NextResponse.json({ spans: recentSpans(limit) });
}
