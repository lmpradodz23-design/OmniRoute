/**
 * GET /api/loop/[id]/stream — transmite um run do Loop como eventos AG-UI (SSE), incrementalmente.
 *
 * Autenticado (management) e gated por LOOP_ENGINE_ENABLED — ambos checados ANTES de abrir o
 * stream; run inexistente → 404. O stream em si (snapshot, polling de mudanças, heartbeat,
 * terminal, teto de duração, Last-Event-ID) vive em `@/lib/loopRunStream`. Report-only.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getLoopRun } from "@/lib/loopRunner";
import { loopRunSseResponse } from "@/lib/loopRunStream";
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

  return loopRunSseResponse(run, req);
}
