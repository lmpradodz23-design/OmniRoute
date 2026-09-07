/**
 * POST /api/loop/[id]/approve — aprova ou rejeita uma etapa aguardando aprovação humana.
 * Body: { stepId: string, decision: "approve" | "reject" }.
 * Aprovar libera o run; rejeitar marca a etapa. Efeito externo real (quando aprovado) é
 * executado pelos conectores do OmniRoute, fora daqui.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { approveStep, rejectStep } from "@/lib/loopRunner";
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
    stepId?: unknown;
    decision?: unknown;
  };
  const stepId = typeof body.stepId === "string" ? body.stepId : "";
  const decision = body.decision === "reject" ? "reject" : "approve";
  if (!stepId) return NextResponse.json({ error: "stepId is required" }, { status: 400 });
  try {
    const run = decision === "reject" ? rejectStep(id, stepId) : approveStep(id, stepId);
    return NextResponse.json({ run, decision });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "approve failed" },
      { status: 404 }
    );
  }
}
