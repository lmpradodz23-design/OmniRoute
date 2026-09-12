/**
 * POST /api/mcp/review/revoke — revoga a aprovação vigente de um servidor MCP.
 * Body: { name, source }.
 *
 * Depois de revogado, `POST /api/mcp/review` volta a tratar o candidato como novo
 * (`review_required`). A linha não é apagada: só ganha `revoked_at`/`revoked_by`. Admin (herda
 * `/api/mcp` em ADMIN_SCOPE_PREFIXES) e gated por MCP_REVIEW_ENABLED (404 desligado). Sem
 * aprovação vigente para (name, source) → 404 `MCP_APPROVAL_NOT_FOUND`.
 *
 * É um POST num sub-recurso, e não um DELETE com corpo, porque vários clientes e proxies
 * descartam corpo em DELETE e a identidade do servidor (name + source) não cabe num segmento.
 */
import { NextRequest, NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { revokeMcpReviewApproval } from "@/lib/db/mcpReviewApprovals";
import {
  mcpCandidateSchema,
  mcpReviewDisabledResponse,
  mcpReviewFailureResponse,
  resolveMcpReviewActor,
} from "@/lib/mcpReview/request";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const revokeBodySchema = mcpCandidateSchema.pick({ name: true, source: true });

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("MCP_REVIEW_ENABLED")) return mcpReviewDisabledResponse();

  const validation = validateBody(revokeBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return createErrorResponse({
      status: 400,
      message: "body must be { name: string(1-200), source: string(1-2048) }",
      details: validation.error.details,
    });
  }

  const { name, source } = validation.data;
  let revoked: boolean;
  try {
    revoked = revokeMcpReviewApproval(name, source, resolveMcpReviewActor(req));
  } catch {
    return mcpReviewFailureResponse();
  }
  if (!revoked) {
    return createErrorResponse({
      status: 404,
      message: "No active MCP approval for this name and source.",
      details: { code: "MCP_APPROVAL_NOT_FOUND" },
    });
  }
  return NextResponse.json({ revoked: true, name, source });
}
