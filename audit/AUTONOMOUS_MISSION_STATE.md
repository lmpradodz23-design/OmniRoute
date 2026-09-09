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
- [x] #1 SSRF teste de webhook — hardenedWebhookFetch (resolve+pin+no-redirect+no-body-privado). Commit 7488e1cbf. 18/18 testes.
- [x] #5 OpenAPI Try confused deputy — bloqueia LOCAL_ONLY/ALWAYS_PROTECTED + GET/HEAD no /api/ + sem cookie implícito. 6/6 testes.
- [x] #8 webhook secret encryption — cifra no write, decifra na leitura, backfill idempotente + integridade HMAC. 4/4 + 46/46 regressao.
- [x] #2 LOCAL_ONLY loopback-only — removida exceção LAN; LAN só via carve-out autenticado; spawn só loopback. 22/22 + 93/93.
- [x] #4 MCP scopes default-on fail-closed — isMcpScopeEnforcementEnabled (default ON, opt-out explicito). 6/6 + 70/70 sem regressao.
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
