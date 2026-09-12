/**
 * POST /api/loop/[id]/advance — avança UM passo do run (report-only, persistente).
 * Body opcional: { consumed?: {tokens?,wallClockMs?,attempts?}, expectedSequenceNumber?: number }.
 * `expectedSequenceNumber` é a versão que o cliente viu; se o run já mudou → 409 (nada gravado).
 * O gate segura efeitos externos em awaiting_approval; nada é executado aqui.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { loopErrorResponse } from "@/lib/api/loopErrorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { advanceRun } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

/** Consumo reportado alimenta o teto do orçamento: só inteiros finitos ≥ 0, sem chaves extras. */
const nonNegativeInt = z.number().int().nonnegative();
const advanceSchema = z.object({
  consumed: z
    .strictObject({
      tokens: nonNegativeInt.optional(),
      wallClockMs: nonNegativeInt.optional(),
      attempts: nonNegativeInt.optional(),
    })
    .optional(),
  expectedSequenceNumber: nonNegativeInt.optional(),
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
  const validation = validateBody(advanceSchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return createErrorResponse({
      status: 400,
      message:
        "body must be { consumed?: { tokens?, wallClockMs?, attempts? } (non-negative integers, no other keys), expectedSequenceNumber?: non-negative integer }",
      details: validation.error.details,
    });
  }
  try {
    const result = advanceRun(id, {
      consumed: validation.data.consumed,
      expectedSequenceNumber: validation.data.expectedSequenceNumber,
      policy: { reportOnly: true },
    });
    return NextResponse.json(result);
  } catch (e) {
    return loopErrorResponse(e);
  }
}
