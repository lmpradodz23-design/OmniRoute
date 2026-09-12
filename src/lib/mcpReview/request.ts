/**
 * Peças compartilhadas pelas rotas do MCP Review Gate (`/api/mcp/review`,
 * `/api/mcp/review/approve`, `/api/mcp/review/revoke`): o schema da fronteira, a resposta de
 * flag desligada, a identificação de quem aprova e o erro genérico.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { readSubjectFromHeaders } from "@/server/authz/assertAuth";
import type { McpPriorApproval } from "@omniroute/open-sse/mcp-review/index.ts";

import type { McpReviewApproval } from "@/lib/db/mcpReviewApprovals";

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

export const mcpCandidateSchema = z.strictObject({
  name: z.string().min(1).max(200),
  source: z.string().min(1).max(2048),
  version: z.string().min(1).max(64),
  permissions: z.array(permission).max(256),
  publisherVerified: z.boolean().optional(),
  flaggedMalicious: z.boolean().optional(),
});

export function mcpReviewDisabledResponse(): Response {
  return NextResponse.json(
    { error: "MCP Review is disabled. Enable MCP_REVIEW_ENABLED in the OmniRoute panel." },
    { status: 404 }
  );
}

/** Falha inesperada (ex.: banco): mensagem genérica, nunca o `err.message` cru. */
export function mcpReviewFailureResponse(): Response {
  return createErrorResponse({ status: 500, message: "MCP review request failed" });
}

/** Rótulo gravado quando nenhum sujeito autenticado foi carimbado no request. */
const UNATTRIBUTED_ACTOR = "management:unattributed";

/**
 * Quem aprovou/revogou, a partir do sujeito que o pipeline de authz carimba no request depois
 * de autenticar (os cabeçalhos são removidos da entrada do cliente antes, então não são
 * forjáveis pela rede). Grava `tipo:id` — id de API key, de access token ou "dashboard",
 * nunca o valor de uma credencial. Chamadas que não passam pelo pipeline (invocação em
 * processo, testes) não têm sujeito: ficam com um rótulo estável e honesto, não inventado.
 */
export function resolveMcpReviewActor(req: Request): string {
  const subject = readSubjectFromHeaders(req.headers);
  if (subject.kind === "anonymous" || !subject.id) return UNATTRIBUTED_ACTOR;
  return `${subject.kind}:${subject.id}`.slice(0, 200);
}

/** A aprovação gravada vira o `prior` do motor. Só aprovações vigentes chegam aqui. */
export function approvalToPrior(approval: McpReviewApproval | null): McpPriorApproval | undefined {
  if (!approval) return undefined;
  return { version: approval.version, permissions: approval.permissions, approved: true };
}
