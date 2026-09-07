/**
 * POST /api/loop/[id]/advance — avança UM passo do run (report-only, persistente).
 * Body opcional: { consumed?: {tokens?,wallClockMs?,attempts?} }.
 * O gate segura efeitos externos em awaiting_approval; nada é executado aqui.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { advanceRun } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) {
    return NextResponse.json({ error: "Loop Engine is disabled." }, { status: 404 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    consumed?: { tokens?: number; wallClockMs?: number; attempts?: number };
  };
  try {
    const result = advanceRun(id, { consumed: body.consumed, policy: { reportOnly: true } });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "advance failed" },
      { status: 404 }
    );
  }
}
