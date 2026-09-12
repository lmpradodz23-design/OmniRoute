/**
 * POST /api/mcp/review — roda o MCP Review Gate determinístico sobre um candidato.
 * Body: { candidate: McpCandidate, prior?: McpPriorApproval }.
 *
 * Autenticado (management, escopo admin nas mutações) e gated por MCP_REVIEW_ENABLED. Código
 * decide (não a IA): malicioso/permissão proibida → denied; novo ou permissão ampliada →
 * review_required (aprovação humana).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { traceSync } from "@/lib/otel";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { reviewMcpCandidate } from "@omniroute/open-sse/mcp-review/index.ts";

/**
 * Limites reais, não decorativos: um candidato vem de um registry de terceiros, e este corpo é
 * a fronteira. `strictObject` recusa chaves desconhecidas para que um campo inventado não
 * atravesse até o motor de decisão, e o teto de permissões impede que uma lista gigante
 * transforme a revisão num varredor de CPU.
 */
const permission = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:*-]+$/, "permission must match [A-Za-z0-9._:*-]");

const candidateSchema = z.strictObject({
  name: z.string().min(1).max(200),
  source: z.string().min(1).max(2048),
  version: z.string().min(1).max(64),
  permissions: z.array(permission).max(256),
  publisherVerified: z.boolean().optional(),
  flaggedMalicious: z.boolean().optional(),
});

const priorSchema = z.strictObject({
  version: z.string().min(1).max(64),
  permissions: z.array(permission).max(256),
  approved: z.boolean(),
});

const reviewBodySchema = z.strictObject({
  candidate: candidateSchema,
  prior: priorSchema.optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("MCP_REVIEW_ENABLED")) {
    return NextResponse.json(
      { error: "MCP Review is disabled. Enable MCP_REVIEW_ENABLED in the OmniRoute panel." },
      { status: 404 }
    );
  }

  const validation = validateBody(reviewBodySchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return NextResponse.json(
      { error: "candidate {name, source, version, permissions[]} is required" },
      { status: 400 }
    );
  }

  const { candidate, prior } = validation.data;
  const verdict = traceSync("mcp.review", { route: "/api/mcp/review", provider: "mcp" }, () =>
    reviewMcpCandidate(candidate, prior)
  );
  return NextResponse.json({ verdict });
}
