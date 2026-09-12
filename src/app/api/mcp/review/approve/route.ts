/**
 * POST /api/mcp/review/approve — aprovação HUMANA de um candidato MCP.
 * Body: { candidate: McpCandidate }.
 *
 * Grava a aprovação corrente de (name, source) na loja server-side; é dela que
 * `POST /api/mcp/review` tira o `prior`. Admin (herda `/api/mcp` em ADMIN_SCOPE_PREFIXES) e
 * gated por MCP_REVIEW_ENABLED (404 desligado).
 *
 * Aprovar não passa por cima do gate: o candidato é reavaliado aqui e, se o veredito for
 * `denied` (malicioso ou permissão proibida), nada é gravado e a resposta é 422
 * `MCP_REVIEW_DENIED`. Um humano pode liberar o que exige revisão, não o que o código proíbe.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { recordMcpReviewApproval } from "@/lib/db/mcpReviewApprovals";
import {
  approvalToPrior,
  mcpCandidateSchema,
  mcpReviewDisabledResponse,
  mcpReviewFailureResponse,
  resolveMcpReviewActor,
} from "@/lib/mcpReview/request";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { reviewMcpCandidate } from "@omniroute/open-sse/mcp-review/index.ts";

const approveBodySchema = z.strictObject({
  candidate: mcpCandidateSchema,
});

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("MCP_REVIEW_ENABLED")) return mcpReviewDisabledResponse();

  const validation = validateBody(approveBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return createErrorResponse({
      status: 400,
      message: "body must be { candidate: { name, source, version, permissions[] } }",
      details: validation.error.details,
    });
  }

  const { candidate } = validation.data;
  // Sem prior de propósito: o que se avalia é o candidato em si, não se já havia aprovação.
  const gate = reviewMcpCandidate(candidate);
  if (gate.state === "denied") {
    return createErrorResponse({
      status: 422,
      message: "The MCP Review Gate denies this candidate; it cannot be approved.",
      details: { code: "MCP_REVIEW_DENIED", reasons: gate.reasons },
    });
  }

  try {
    const approval = recordMcpReviewApproval(candidate, resolveMcpReviewActor(req));
    // Veredito efetivo com a aprovação recém-gravada: mostra se a próxima revisão deste mesmo
    // candidato já sai `approved` ou ainda exige, por exemplo, publisher verificado.
    const verdict = reviewMcpCandidate(candidate, approvalToPrior(approval));
    return NextResponse.json({ approval, verdict }, { status: 201 });
  } catch {
    return mcpReviewFailureResponse();
  }
}
