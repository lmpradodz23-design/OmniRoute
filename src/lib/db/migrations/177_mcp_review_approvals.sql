-- 177_mcp_review_approvals.sql
--
-- Loja server-side das aprovações humanas do MCP Review Gate. Aditiva, idempotente
-- (IF NOT EXISTS) e não-destrutiva: só cria uma tabela e seus índices.
--
-- Por que existe: `POST /api/mcp/review` aceitava `prior.approved` no corpo e deixava o
-- chamador afirmar a própria aprovação. Removido o campo, sem uma loja todo candidato ficava
-- `review_required` para sempre. A aprovação anterior agora vem desta tabela, gravada só pelo
-- endpoint administrativo de aprovação, e nunca do corpo da revisão.
--
-- Uma linha por (tenant, name, source): a aprovação CORRENTE. Reaprovar sobrescreve a linha e
-- limpa `revoked_at`; revogar só marca `revoked_at`. Nada é apagado.
CREATE TABLE IF NOT EXISTS mcp_review_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  version TEXT NOT NULL,
  -- JSON array, normalizado: trim + lowercase, sem duplicatas, ordenado.
  permissions_json TEXT NOT NULL,
  publisher_verified INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_review_approvals_current
  ON mcp_review_approvals (tenant_id, name, source);
CREATE INDEX IF NOT EXISTS idx_mcp_review_approvals_tenant
  ON mcp_review_approvals (tenant_id, revoked_at);
