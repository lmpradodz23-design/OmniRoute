/**
 * GET /api/loop/[id] — retorna um run do Loop Engine (com suas etapas).
 * Autenticado + gated por LOOP_ENGINE_ENABLED.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getLoopRun } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) {
    return NextResponse.json({ error: "Loop Engine is disabled." }, { status: 404 });
  }
  const { id } = await params;
  const run = getLoopRun(id);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json({ run });
}
