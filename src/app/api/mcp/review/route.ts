/**
 * POST /api/mcp/review — roda o MCP Review Gate determinístico sobre um candidato.
 * Body: { candidate: McpCandidate }. A aprovação anterior é estado do servidor, nunca do corpo.
 *
 * Autenticado (management, escopo admin nas mutações) e gated por MCP_REVIEW_ENABLED. Código
 * decide (não a IA): malicioso/permissão proibida → denied; novo ou permissão ampliada →
 * review_required (aprovação humana); aprovação vigente sem ampliação e publisher verificado →
 * approved.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getActiveMcpReviewApproval } from "@/lib/db/mcpReviewApprovals";
import {
  approvalToPrior,
  mcpCandidateSchema,
  mcpReviewDisabledResponse,
  mcpReviewFailureResponse,
} from "@/lib/mcpReview/request";
import { traceSync } from "@/lib/otel";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { reviewMcpCandidate } from "@omniroute/open-sse/mcp-review/index.ts";

/**
 * O corpo NÃO aceita `prior`. Ele aceitava, e `prior.approved` é exatamente a afirmação que o
 * gate existe para não tomar na palavra: um candidato pedindo `shell:exec`, `fs:delete` e
 * `secrets:read` acompanhado de `{"approved": true}` saía como `approved`, sem revisão humana,
 * porque nada amarrava aquele prior a um registro — nem sequer o `name` era comparado.
 *
 * A aprovação anterior agora vem da loja server-side (`mcp_review_approvals`), chaveada por
 * `name` + `source` do candidato e gravada só por `POST /api/mcp/review/approve`. Sem aprovação
 * vigente (nunca aprovado, ou revogado), o candidato é tratado como novo — fail-closed.
 */
const reviewBodySchema = z.strictObject({
  candidate: mcpCandidateSchema,
});

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("MCP_REVIEW_ENABLED")) return mcpReviewDisabledResponse();

  const validation = validateBody(reviewBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return NextResponse.json(
      { error: "candidate {name, source, version, permissions[]} is required" },
      { status: 400 }
    );
  }

  const { candidate } = validation.data;
  let prior;
  try {
    prior = approvalToPrior(getActiveMcpReviewApproval(candidate.name, candidate.source));
  } catch {
    return mcpReviewFailureResponse();
  }
  const verdict = traceSync("mcp.review", { route: "/api/mcp/review", provider: "mcp" }, () =>
    reviewMcpCandidate(candidate, prior)
  );
  return NextResponse.json({ verdict });
}
