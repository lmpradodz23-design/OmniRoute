# AUTONOMOUS MISSION STATE — Remediação OmniRoute v3.8.51

- **mission_id:** omniroute-sec-remediation-v3.8.51
- **objetivo:** corrigir os 8 findings do scan de segurança + hardening (Fase 2) + CI/supply-chain (Fase 3), com teste de regressão por correção. Sem push/deploy/publish.
- **branch:** `security/remediation-v3.8.51` (base `b345c7f6c` = SHA da missão)
- **estado:** EXECUTING (Fase 1)
- **iteração:** 1
- **início:** 2026-09-09 (sessão retomada)
- **último_heartbeat:** Fase 0 concluída
- **último_progresso_real:** baseline + branch + secret scan feitos; iniciando #1 (SSRF)

## Critérios de aceite (gate final)
working tree limpa · secret scan · lint · typecheck · unit · integração · build · testes Electron · testes MCP authz · testes SSRF · migração+rollback · smoke /v1/models · smoke autenticado /v1/messages e /v1/responses (pede credencial) · nova auditoria sem Critical/High.

## Tarefas (8 findings)
- [ ] #1 SSRF teste de webhook — safeOutboundFetch hardened (EM ANDAMENTO)
- [ ] #5 OpenAPI Try confused deputy
- [ ] #8 webhook secret encryption + migração
- [ ] #2 LOCAL_ONLY loopback-only vs TRUSTED_LAN
- [ ] #4 MCP scopes default-on fail-closed
- [ ] #7 apiKeys somente hash/prefix + migração
- [ ] #3 encryptOrThrow fail-closed + migração
- [ ] #6 Electron remote IPC isolamento

## Fase 2 (após Fase 1 verde)
CSP unsafe-eval · TS strict/ignoreBuildErrors · god-files · plugins sandbox · marketplace extração tar.gz · guardrails obrigatórios · browser/CDP.

## Fase 3
Actions fixadas em SHA · Dependabot · gitleaks/osv/actionlint/oasdiff fixos · npm ci · SBOM · deploy digest-pinned (sem deploy real) · remover refs fixas a diegosouzapw.

## Blockers
- Nenhum interno ainda.
- BLOCKED_BY_EXTERNAL (futuro): smoke autenticado /v1/messages e /v1/responses exige credencial do operador. push/deploy exige autorização explícita.

## Rollback
Commits pequenos e separados na branch; base `b345c7f` intocada. `git revert <commit>` por correção.

## Próxima ação
Ler `src/app/api/webhooks/[id]/test/route.ts` + `safeOutboundFetch.ts`, escrever teste que prova o SSRF por redirect/rebinding, corrigir via helper hardened, testar, commit `fix(ssrf): ...`.
