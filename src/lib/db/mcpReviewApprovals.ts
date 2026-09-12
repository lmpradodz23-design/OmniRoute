/**
 * Loja das aprovações humanas do MCP Review Gate (tabela da migração 177).
 *
 * É daqui, e só daqui, que `POST /api/mcp/review` tira a aprovação anterior de um candidato.
 * O corpo da revisão nunca carrega `prior`: aceitar essa afirmação do chamador foi o bypass
 * que a auditoria da Fase 2 reprovou. Toda leitura e escrita é escopada por tenant.
 *
 * Uma linha por (tenant, name, source) é a aprovação corrente. Reaprovar sobrescreve e limpa a
 * revogação; revogar só marca `revoked_at`. Nenhuma função apaga linha.
 */
import { randomUUID } from "node:crypto";

import { getDbInstance } from "./core";
import { DEFAULT_TENANT } from "./loopEngine";

export interface McpReviewApproval {
  readonly name: string;
  readonly source: string;
  readonly version: string;
  /** Normalizadas: trim + lowercase, sem duplicatas, ordenadas. */
  readonly permissions: string[];
  readonly publisherVerified: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

interface ApprovalInput {
  readonly name: string;
  readonly source: string;
  readonly version: string;
  readonly permissions: ReadonlyArray<string>;
  readonly publisherVerified?: boolean;
}

interface ApprovalRow {
  name: string;
  source: string;
  version: string;
  permissions_json: string;
  publisher_verified: number;
  approved_by: string;
  approved_at: string;
}

/**
 * Mesma normalização do motor (`trim().toLowerCase()`), mais dedup e ordem: a lista gravada
 * é a forma canônica, então duas aprovações do mesmo conjunto são byte a byte iguais.
 */
function normalizePermissions(permissions: ReadonlyArray<string>): string[] {
  return [...new Set(permissions.map((p) => p.trim().toLowerCase()))].sort();
}

function rowToApproval(row: ApprovalRow): McpReviewApproval {
  return {
    name: row.name,
    source: row.source,
    version: row.version,
    permissions: JSON.parse(row.permissions_json) as string[],
    publisherVerified: row.publisher_verified === 1,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}

/** Aprovação VIGENTE (não revogada) de (name, source) no tenant, ou `null`. */
export function getActiveMcpReviewApproval(
  name: string,
  source: string,
  tenantId: string = DEFAULT_TENANT
): McpReviewApproval | null {
  const row = getDbInstance()
    .prepare(
      `SELECT name, source, version, permissions_json, publisher_verified, approved_by, approved_at
       FROM mcp_review_approvals
       WHERE tenant_id = ? AND name = ? AND source = ? AND revoked_at IS NULL`
    )
    .get(tenantId, name, source) as ApprovalRow | undefined;
  return row ? rowToApproval(row) : null;
}

/**
 * Grava (ou substitui) a aprovação corrente de (name, source) e limpa qualquer revogação.
 * Quem chama é responsável por ter passado o candidato pelo gate antes: esta função não decide.
 */
export function recordMcpReviewApproval(
  input: ApprovalInput,
  approvedBy: string,
  tenantId: string = DEFAULT_TENANT
): McpReviewApproval {
  const approvedAt = new Date().toISOString();
  getDbInstance()
    .prepare(
      `INSERT INTO mcp_review_approvals
         (id, tenant_id, name, source, version, permissions_json, publisher_verified, approved_by, approved_at, revoked_at, revoked_by)
       VALUES (@id, @tenant_id, @name, @source, @version, @permissions_json, @publisher_verified, @approved_by, @approved_at, NULL, NULL)
       ON CONFLICT(tenant_id, name, source) DO UPDATE SET
         version = excluded.version,
         permissions_json = excluded.permissions_json,
         publisher_verified = excluded.publisher_verified,
         approved_by = excluded.approved_by,
         approved_at = excluded.approved_at,
         revoked_at = NULL,
         revoked_by = NULL`
    )
    .run({
      id: randomUUID(),
      tenant_id: tenantId,
      name: input.name,
      source: input.source,
      version: input.version,
      permissions_json: JSON.stringify(normalizePermissions(input.permissions)),
      publisher_verified: input.publisherVerified === true ? 1 : 0,
      approved_by: approvedBy,
      approved_at: approvedAt,
    });
  return {
    name: input.name,
    source: input.source,
    version: input.version,
    permissions: normalizePermissions(input.permissions),
    publisherVerified: input.publisherVerified === true,
    approvedBy,
    approvedAt,
  };
}

/** Revoga a aprovação vigente. `false` quando não havia aprovação vigente para revogar. */
export function revokeMcpReviewApproval(
  name: string,
  source: string,
  revokedBy: string,
  tenantId: string = DEFAULT_TENANT
): boolean {
  const result = getDbInstance()
    .prepare(
      `UPDATE mcp_review_approvals SET revoked_at = ?, revoked_by = ?
       WHERE tenant_id = ? AND name = ? AND source = ? AND revoked_at IS NULL`
    )
    .run(new Date().toISOString(), revokedBy, tenantId, name, source);
  return result.changes > 0;
}
