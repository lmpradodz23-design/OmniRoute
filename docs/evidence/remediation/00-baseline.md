# Remediação OmniRoute v3.8.51 — Baseline (Fase 0)

> Documento de evidência. Gerado no início da missão de remediação de segurança.
> Nenhum código foi alterado antes desta baseline.

## 1. Identidade do checkout

| Campo | Valor |
| --- | --- |
| Diretório | `C:\Users\zodyp\Downloads\OmniRoute-Unified\repos\OmniRoute-v3851-port` |
| Remote autorizado | `myfork` = https://github.com/lmpradodz23-design/OmniRoute.git |
| Remote upstream | `origin` = https://github.com/diegosouzapw/OmniRoute.git (partial clone) |
| Branch da missão | `security/remediation-v3.8.51` (criada a partir do SHA exato) |
| HEAD base | `b345c7f6cd4e1590d1177540813302375a75e332` |
| Confirma SHA remoto esperado | **SIM** — `release/v3.8.51` no myfork == `b345c7f6c` |
| Working tree | limpo |

Observação: o SHA `b345c7f` confere com o SHA remoto observado na auditoria. O ZIP
auditado (SHA-256 `9C6CC79…BBD657`) foi usado apenas como referência; o diretório de
trabalho é um checkout Git legítimo, conforme exigido.

## 2. Ferramentas

| Ferramenta | Versão |
| --- | --- |
| node | v24.16.0 |
| npm | 11.13.0 |
| git | 2.55.0 |
| runner de teste | `node --test` + `tsx` (scripts `test:unit`); `vitest` para `.tsx` |
| node_modules | junction para o repo irmão `..\OmniRoute` (mesma versão 3.8.51) |

## 3. Relatório de segurança (fonte de verdade)

- report.md: `C:\Users\zodyp\.codex\security-scans\OmniRoute-release-v3.8.51\unversioned_20260908T234305Z_f51y_o7t\report.md` (46 KB) — lido integralmente.
- SARIF: `…\exports\results.sarif` (39 KB).
- Resultado do scan: 8 findings reportáveis — 7 high + 1 medium, todos confidence high.

### Achados confirmados

| # | Sev | Categoria | Arquivos principais |
| --- | --- | --- | --- |
| 1 | high | SSRF (CWE-918) | `src/app/api/webhooks/[id]/test/route.ts`, `src/shared/network/safeOutboundFetch.ts` |
| 2 | high | missing-authorization (CWE-306/284) | `src/server/authz/policies/management.ts`, `src/server/authz/routeGuard.ts` |
| 3 | high | sensitive-data-exposure (CWE-312/636) | `src/lib/db/encryption.ts`, `src/lib/cloudAgent/credentials.ts`, `src/lib/db/commandCodeAuth.ts` |
| 4 | high | missing-authorization (CWE-862/269) | `open-sse/mcp-server/{server,scopeEnforcement}.ts`, `management.ts` |
| 5 | high | confused-deputy (CWE-441/918/284) | `src/app/api/openapi/try/route.ts` |
| 6 | high | broken-access-control (CWE-346/749/862) | `electron/main.js`, `electron/preload.js`, `electron/loginManager.js`, `electron/lib/resolveRemoteServerUrl.js` |
| 7 | high | sensitive-data-exposure (CWE-312) | `src/lib/db/apiKeys.ts` |
| 8 | medium | sensitive-data-exposure (CWE-312) | `src/lib/db/webhooks.ts`, `src/lib/webhookDispatcher.ts` |

Superfícies "Needs follow-up" no relatório: plugins/marketplace, guardrails, CI/supply-chain, container/browser sidecar (endereçadas na Fase 2/3).

## 4. Secret scan de baseline

- `scripts/check/check-secrets.mjs`: **SKIP** — gitleaks ausente no PATH (sai 0 gracioso).
- Scan best-effort por padrões de alta confiança (chaves privadas, AKIA, `sk-…`, `ghp_…`, `xox…`) em `src/ open-sse/ electron/ scripts/`: **nenhum segredo hardcoded** (bate com o relatório: "secret-pattern review: No issue found").
- Pendência de Fase 3: instalar/fixar gitleaks no CI e fazer o gate falhar quando o scanner estiver ausente.

## 5. Plano de commits (ordem de execução por risco × tratabilidade)

Cada correção: teste que prova a falha → correção de causa raiz → testes +/- → lint/typecheck focados → commit separado (`fix(<escopo>): …`). **Sem push** (regra da missão).

1. `fix(ssrf)` — #1 teste de webhook usa `safeOutboundFetch` hardened (helper seguro já existe, não usado).
2. `fix(confused-deputy)` — #5 OpenAPI Try: allowlist read-only, bloquear LOCAL_ONLY/ALWAYS_PROTECTED, não encaminhar credenciais.
3. `fix(webhooks)` — #8 cifrar segredo do webhook (envelope) + migração idempotente.
4. `fix(authz)` — #2 separar LOOPBACK_ONLY de TRUSTED_LAN; host-sensitive só loopback.
5. `fix(mcp)` — #4 enforcement de escopos default-on fail-closed.
6. `fix(security)` — #7 apiKeys somente hash/prefix + migração + reveal one-time.
7. `fix(security)` — #3 contrato `encryptOrThrow`, fail-closed, migração legado.
8. `fix(electron)` — #6 janela/preload remoto sem IPC privilegiado, guarda de origem.

## 6. Rollback

- Todo trabalho na branch `security/remediation-v3.8.51`; base intocada em `b345c7f`.
- Reverter: `git checkout b345c7f -- <arquivo>` ou `git revert <commit>` por correção (commits pequenos e separados).
- Migrações: cada uma idempotente, transacional e com verificação; nenhuma destrói dados que não possam ser migrados (registra bloqueio seguro).
- Nenhum push/deploy/publish nesta missão — o estado remoto não é tocado.

## 7. Riscos conhecidos

- Codebase grande (13.504 arquivos) não escrito por nós; mudanças em authz/crypto/Electron têm blast radius alto — mitigado por testes de regressão e ausência de push.
- Migrações de crypto (#3/#7/#8) exigem cuidado para não perder dados — abordagem: migrar e verificar, nunca apagar sem envelope.
- Build completo do Next exige ~7 GB RAM; typecheck/testes focados são a via de verificação nesta missão.
