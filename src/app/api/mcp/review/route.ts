/**
 * POST /api/mcp/review — roda o MCP Review Gate determinístico sobre um candidato.
 * Body: { candidate: McpCandidate, prior?: McpPriorApproval }.
 *
 * Autenticado (management) e gated por MCP_REVIEW_ENABLED. Código decide (não a IA): malicioso/
 * permissão proibida → denied; novo ou permissão ampliada → review_required (aprovação humana).
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { traceSync } from "@/lib/otel";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import {
  reviewMcpCandidate,
  type McpCandidate,
  type McpPriorApproval,
} from "@omniroute/open-sse/mcp-review/index.ts";

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("MCP_REVIEW_ENABLED")) {
    return NextResponse.json(
      { error: "MCP Review is disabled. Enable MCP_REVIEW_ENABLED in the OmniRoute panel." },
      { status: 404 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    candidate?: Partial<McpCandidate>;
    prior?: McpPriorApproval;
  };
  const c = body.candidate;
  if (
    !c ||
    typeof c.name !== "string" ||
    typeof c.source !== "string" ||
    typeof c.version !== "string" ||
    !Array.isArray(c.permissions)
  ) {
    return NextResponse.json(
      { error: "candidate {name, source, version, permissions[]} is required" },
      { status: 400 }
    );
  }

  const verdict = traceSync("mcp.review", { route: "/api/mcp/review", provider: "mcp" }, () =>
    reviewMcpCandidate(c as McpCandidate, body.prior)
  );
  return NextResponse.json({ verdict });
}
