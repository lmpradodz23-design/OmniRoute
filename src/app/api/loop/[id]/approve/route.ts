/**
 * POST /api/loop/[id]/approve — aprova ou rejeita uma etapa aguardando aprovação humana.
 * Body: { stepId: string, decision?: "approve" | "reject" } (padrão: approve).
 * Aprovar exige run em awaiting_approval + etapa proposta e reavalia o Policy Gate (efeito
 * destrutivo nunca é aprovado → 409). Rejeitar marca a etapa (o próximo advance escala para
 * humano se não houver nova proposta). Efeito externo real (quando aprovado) é executado
 * pelos conectores do OmniRoute, fora daqui.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { loopErrorResponse } from "@/lib/api/loopErrorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { approveStep, rejectStep } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const approveSchema = z.object({
  stepId: z.string().min(1).max(64),
  decision: z.enum(["approve", "reject"]).default("approve"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) {
    return createErrorResponse({ status: 404, message: "Loop Engine is disabled." });
  }
  const { id } = await params;
  const validation = validateBody(approveSchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return createErrorResponse({
      status: 400,
      message: 'body must be { stepId: string(1-64), decision?: "approve" | "reject" }',
      details: validation.error.details,
    });
  }
  const { stepId, decision } = validation.data;
  try {
    const run = decision === "reject" ? rejectStep(id, stepId) : approveStep(id, stepId);
    return NextResponse.json({ run, decision });
  } catch (e) {
    return loopErrorResponse(e);
  }
}
