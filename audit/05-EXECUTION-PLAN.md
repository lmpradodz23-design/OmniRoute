# 05 — Plano de execução (Fase 0 → Fases 1–9)

HEAD de partida: `2a156c73812d45119d5a06a2f55d611280442860` · Branch: `fix/final-user-readiness` · Repo canônico: `LMPrado-DZ23/OmniRoute`. Insumos: `01-CURRENT-STATE`, `02-ARCHITECTURE` (R-*), `03-SECURITY-FINDINGS` (S-*, M-*, P-*, E-*, SC-*), `04-PRODUCT-GAPS` (J*, U*, A*, I*).

## 0. Regras que governam toda a execução

- **Nunca** sem confirmação: push, PR, publish (npm/Docker/Electron/Release), deploy, apagar dados reais, force push, credenciais reais, custos externos, reduzir segurança, enfraquecer testes.
- Loop por item: provar → corrigir causa raiz → **teste de regressão** → testes focados → inspecionar → secret scan → `git diff --check` → revisar staged diff → **um problema por commit** → checkpoint.
- 3 tentativas equivalentes sem progresso → mudar estratégia; 5 → agente diagnóstico independente.
- Servidores de teste: bind `127.0.0.1`, porta isolada (`DASHBOARD_PORT`; API Bridge quer 20128 — usar porta livre ou aceitar bridge off), `DATA_DIR` temporário, PID registrado, `try/finally`, encerrar árvore, confirmar porta livre. Exit 124 = timeout, não aprovação.
- Resultados não executados = `NOT_RUN`, nunca `PASS`.
- **Secret scan:** gitleaks ausente no host (SC-1). Controle compensatório em cada commit: varredura regex do diff staged (`sk-`, `AKIA`, `ghp_`, `xox[abp]-`, `-----BEGIN`, `Bearer `, `api[_-]?key\s*[:=]`, `password\s*[:=]`, 40+ hex/base64 longos). Não substitui o gate; o gate real fica `NOT_RUN` até o binário existir (pede autorização de download ao operador).

## 1. Ordem geral (maior risco pendente primeiro)

| Ordem | Fase | Bloco | Achados | Motivo da prioridade |
|---|---|---|---|---|
| 1 | 1 | SSRF outbound | S-1, S-2, S-3, S-4, S-5, S-6 | HIGH, alcançável por operador/registro remoto; dispatcher de produção aberto |
| 2 | 1 | MCP escopos | M-1, M-2, R-10 | HIGH, escalada de sessão-cookie/stdio |
| 3 | 1 | Electron IPC/nav | E-1, E-2, E-3, E-7 | HIGH residual do #6 |
| 4 | 1 | OpenAPI Try | #5 residual (cookie/Authorization implícitos, mutáveis, prefixo `/api/`) | MEDIUM-HIGH |
| 5 | 1 | API keys | #7 residual (reveal único; avaliar hash+prefixo apenas) | MEDIUM |
| 6 | 1 | Criptografia/readiness | #3 residual (perfil exposto exige chave; readiness detecta plaintext) | MEDIUM |
| 7 | 1 | LOCAL_ONLY matriz | #2 matriz rota×origem×auth | garante não regressão |
| 8 | 5 | Onboarding | U1 (erro silencioso), U2, U3, U4, U8 | HIGH para usuário final |
| 9 | 8 | Identidade do fork | E-9, J15, mapa de `diegosouzapw` em `04` | HIGH: updater/version-check apontam ao upstream |
| 10 | 7 | Supply chain | SC-1, SC-4, SC-5, SC-2/6, SC-7, SC-8 | gates de release |
| 11 | 3 | Plugins/marketplace | P-1, P-2/P-3 (disclosure), P-4, P-7, P-6 | MEDIUM-HIGH + bug funcional |
| 12 | 2 | Confiabilidade/DB | R-1 (rollback), R-2, R-3, R-4, R-5, R-6, R-12, R-13, R-14 | integridade e recuperação |
| 13 | 2 | Tipagem | R-20 (`ignoreBuildErrors`, typecheck electron/bin/packages) | progressivo por pacote |
| 14 | 4 | Guardrails/PII | separar obrigatórios/opcionais; fail-closed; alinhar 3 endpoints; testes CPF/cartão/token | privacidade |
| 15 | 5 | UX/a11y restante | A1, A2, M1, I1–I3, J2, J13, J17 | WCAG AA |
| 16 | 6 | Compatibilidade | `/v1/*`, SSE, Codex, Claude Code, SDKs, MCP, cancelamento, usage | contrato público |
| 17 | 9 | Testes e empacotamento | matriz sequencial, build, Electron package, clean-install smoke | gates finais |
| 18 | — | CANDIDATE_COMPLETED → 3 auditorias independentes → fix loop → COMPLETED | — | — |

## 2. Fase 1 — Segurança P0 (detalhe)

### 2.1 SSRF (Fase 1 §4)
- **Fix:** cliente outbound seguro único = `hardenedWebhookFetch`/`safeOutboundFetch` com resolução A+AAAA, bloqueio de privado/reservado/metadata em **todos os hops**, `redirect:"manual"`, IP pinado, sem corpo de destino não público.
  - S-1: `src/lib/webhookDispatcher.ts` (`deliverRaw`/`deliverWebhook`/Telegram) → helper seguro; não expor `res.status` de destino não público no log/oráculo.
  - S-2: portar root-dot strip, `::` prefix, `/^fe[89ab]/` de `src/lib/proxyRelay/privateHostname.ts` para `src/shared/network/privateHost.ts`; fazer `proxyRelay` e `db/upstreamProxy.ts` importarem o canônico (colapsar 3 cópias); tratar literais decimal/octal/hex sem depender de `new URL`.
  - S-3: `gamification/servers.ts` + validação de URL no `POST /api/gamification/servers`; não refletir corpo.
  - S-4: OIDC — validar `token_endpoint`/`authorization_endpoint` (HTTPS, mesmo host do issuer ou allowlist) antes de POSTar `client_secret`; guard privado.
  - S-5/S-6: Obsidian, Qdrant, genericBackend, translator, rerank, agentSkills, healthMonitor, notion, telegram, cloudAgent → guard (loopback explícito só por config assinada pelo operador; nunca metadata).
  - **EXECUTADO (S-1…S-6 + S-7 novo):** ver tabela de status em `03-SECURITY-FINDINGS.md` §2.2. Decisão de política registrada ali (integrações = local-first como providers; webhooks/federação/OIDC = opt-in estrito). Trava estrutural `tests/unit/outbound-sinks-no-bare-fetch.test.ts`. Residual LOW: `jose.createRemoteJWKSet` não pinado.
- **Testes de regressão:** redirect público→privado bloqueado; rebinding IPv4/IPv6; metadata em todos os hops; `localhost.`/`::7f00:1`/`feb0::1`/`2130706433` bloqueados no canônico; OIDC não envia secret a host fora do issuer.
- **Done:** todos os sinks de `03 §2.2` passam pelo helper; teste unitário por sink ou por helper + grep-gate (`scripts/check/check-fetch-targets.mjs` já existe — estender).

### 2.2 MCP (Fase 1 §7)
- **Fix M-1:** `resolveCallerScopeContext` ignora `extra._meta` (fonte só `authInfo` → env); para sessão por cookie sem chave: negar tools que exijam escopo (ou emitir `authInfo` server-side com escopo explícito de "management session"); chave com `scopes:[]` = sem escopo.
- **M-2:** `*` não satisfaz `admin:*` sem menção explícita (ou documentar + auditar emissão).
- **R-10:** audit grava `callerId` resolvido.
- **Testes:** atualizar `t08` (asserção: `_meta` ignorado, `source` nunca `"meta"`); novos: stdio com `_meta:["*"]` negado; cookie-session sem chave negado em `write:*`; chave `scopes:[]` negada; matriz chave×tool×escopo; docs `MCP-SERVER.md` corrigidas.

### 2.3 Electron (Fase 1 §1)
- E-1: `mainWindow.webContents.on("will-navigate"|"will-redirect")` com `isCrossOriginNavigation` → `preventDefault`; `setWindowOpenHandler` deny.
- E-2: aplicar `isPrivilegedSenderAllowed` em **todo** `ipcMain.handle/on` privilegiado (restart, update, autostart, data-dir, open-external).
- E-3: `sandbox:true` na janela principal; preload remoto mínimo separado (já existe `remoteServerPromptPreload.js` — padrão a seguir).
- HTTPS obrigatório fora de loopback em `resolveRemoteServerUrl`.
- E-7: `server.env` com `mode:0o600`.
- **Testes:** guard puro (já existe) + testes de `main.js` isolando handlers (injetar `event.sender`/`senderFrame`); nav cross-origin bloqueada.

### 2.4 OpenAPI Try (Fase 1 §3)
- Allowlist explícita de paths (sem `/api/` genérico); métodos mutáveis só com flag/escopo específico; **não** encaminhar `Cookie`/`Authorization` por padrão; manter bloqueio LOCAL_ONLY/ALWAYS_PROTECTED; preferir serviço interno tipado onde houver.
- **Testes:** cookie não encaminhado; mutável sem autorização → 405/403; destinos locais 403. Ajustar `openapi-try-route` sem enfraquecer (a reversão anterior foi para destravar CI; agora refazer com testes coerentes).

### 2.5 API keys (Fase 1 §5)
- Reveal único: `/api/keys/{id}/reveal` removido ou trocado por regeneração; UI/doc alinhados (`QUICK-START.md:82`).
- Avaliar Opção A (só `key_hash`+`key_prefix`, zerar coluna) com migração idempotente + teste de validação; documentar rotação.

### 2.6 Criptografia/readiness (Fase 1 §6)
- `assertStorageEncryptionConfigured` já existe: exigir chave quando perfil exposto (bind ≠ loopback ou `requireLogin=false` público) — falhar startup; readiness (`/api/monitoring/health`) reporta `insecure_storage` se houver linha sensível não `enc:v1:`.
- Cifrar `JWT_SECRET`/`API_KEY_SECRET` em repouso onde persistidos.

### 2.7 LOCAL_ONLY (Fase 1 §2)
- Teste matricial: {loopback, LAN, público} × {sem auth, cookie, api-key manage, api-key mcp:connect} × {PUBLIC, CLIENT_API, MANAGEMENT, LOCAL_ONLY, ALWAYS_PROTECTED} com `requireLogin` on/off.

## 3. Fases 2–9 (resumo executável)

- **Fase 2 (ordem do auditor de qualidade + R-*):** (1) **F1** quebrar o SCC de 33 arquivos em `src/lib/db` (`check:cycles`); (2) **F3** religar/apagar os 63 testes mascarados no `vitest.config.ts` e ensinar `check-test-discovery` a ler `exclude`; (3) **F2** file-size: encolher `apiKeys.ts`/`core.ts`/`mcp server.ts` ou rebaseline justificado, e frear a cadência de `_rebaseline_*`; (4) **F4/F20** remover `@ts-nocheck` primeiro de `proxyFetch.ts` e `tokenRefresh/**`, apertar baseline do dashboard (324→207), tsconfig escopado com baseline para `src/lib|server|sse`; (5) **F13** logar os `catch {}` críticos (`encryption.ts:111`, `httpTransport.ts:40/309`, `proxyDispatcher*`), regra `no-empty` nesses diretórios; (6) **F14** timeout padrão em `fetch` (áudio, kiro OAuth, `proxyFetch`) + lint preventivo; (7) **F7** resolver bins `type-coverage`/`jscpd`/`knip` de forma portátil (destrava 3 gates no Windows); (8) **F16/F19/F21** `--test-force-exit` no `test`, `listen(0)`, reativar skips de resiliência, remover include morto; (9) R-1 rollback (= restaurar snapshot pré-migração com verificação + `ROLLBACK.md`), R-2 transações (`createApiKey`, `deleteApiKey`, `reorderConnections`, `registeredKeys`, `callLogs`), R-3 retry `SQLITE_BUSY`, R-4, R-5 guard "bytes emitidos ⇒ sem refazer", R-6 shutdown único + `globalThis`, R-12 `detached`/PID, R-13 `0o600`, R-14; (10) R-20 `ignoreBuildErrors` → remoção progressiva por pacote (open-sse já 0; api/dashboard por baseline; `electron` `@ts-check`; `bin` tsconfig); (11) F11 `createTtlQuotaCache()`, F5 ratchet de suppressions por diretório, F6 gate `prettier --check` + `.gitattributes eol=lf`, F12 poda de dead code/27 scripts órfãos, F15 `no-floating-promises` com baseline.
- **Fase 3:** P-1 checksum obrigatório (+assinatura); P-4 extração segura de tar.gz (traversal, symlink, bomb, limites, tmp isolado, cleanup, `realpath`) ou desabilitar com mensagem; P-2/P-3 disclosure "plugins executam código confiável com privilégios do processo" na UI/docs (e enforcement via permission model quando viável); P-7; P-6; P-8.
- **Fase 4:** inventário de guardrails; obrigatórios não desativáveis por body/header; fail-closed; paridade `/v1/chat/completions`/`/v1/messages`/`/v1/responses`; logs/telemetria/Qdrant sem segredos; testes CPF/cartão/token/cookie/prompt-injection.
- **Fase 5:** U1 → U8, A1, A2, M1, I1–I3, J2 (`did-fail-load`), J13, J17 (`uninstall:full` confirmação; desinstalador informa retenção); docs pt-BR (QUICK-START, Codex, Claude Code, "primeiro uso em 5 passos"); WCAG AA.
- **Fase 6:** validar `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, SSE, cancelamento, usage, erros tipados com **instância isolada** (chave OmniRoute local, sem provedor pago); E2E autenticado real = `BLOCKED_BY_EXTERNAL_DEPENDENCY`.
- **Fase 7:** SC-1 estrito; SC-4/SC-2/6 pinar (replicar `quality.yml:224-233`); SC-5 deploy digest-pinned + `NOT_DEPLOYED` (sem executar); SC-7; SC-8 digests; SBOM/provenance (já há `sbom-action` — pinar); converter `uses:` por tag → SHA; atualização automatizada dos SHAs (Dependabot/Renovate).
- **Fase 8:** `electron/package.json` publish; `versionCheck.ts`; `HomePageClient` downloads; `releaseNotes.ts`; `agentSkills.ts`; links/badges/README; `docker-publish.yml`/`npm-publish.yml`/`radar-export.yml`/CODEOWNERS; scripts → `LMPrado-DZ23/OmniRoute`. Manter upstream deliberado (`.mailmap`, CHANGELOG, "Fixes #", notices, OmniCopilot).
- **Fase 9:** executar sequencialmente e registrar exit codes em `TEST_MATRIX.md`: clean install (`npm ci`), lockfile, lint, format, typecheck (todos os tsconfigs), unit (shards), integration, contract, API, auth, authz matriz, MCP matriz, SSRF, migrations + rollback, webhooks, plugins, Electron (unit + package), browser automation, E2E (isolado), a11y, build, package, installer (Electron `--dir` mínimo), clean-install smoke (`check-install-upgrade.mjs`), secret scan (NOT_RUN se sem binário), dependency scan, security scan (semgrep local se disponível). Artefatos com SHA-256.

## 4. Blockers externos (registrar, não travar)

- Secret scan real (gitleaks) — download exige autorização.
- Smoke autenticado real `/v1/messages`/`/v1/responses` — credencial + custo.
- Code-signing Electron (E-4) — certificados do operador.
- Push/PR/publish/deploy — autorização explícita.

## 5. Critério de conclusão (da missão)

blockers internos = 0 · Critical = 0 · High = 0 · secret scan PASS · dependency scan PASS · lint PASS · typecheck PASS · unit PASS · integration PASS · security tests PASS · authz matriz PASS · MCP matriz PASS · migrations PASS · rollback PASS · build PASS · Electron package PASS · clean-install smoke PASS · functional acceptance PASS · a11y PASS · 3 auditorias independentes PASS · sem porta/processo órfão · docs atualizadas · working tree limpa ou só blockers externos documentados.

## 6. Pendências da própria Fase 0

- Adendo de arquivos gigantes em `02` (auditor de arquitetura).
- Números de lint/format/TS/testes instáveis (auditor de qualidade) → refinar Fase 2/9 e `TEST_MATRIX.md`.
- Adendo do auditor de segurança em `03`, se trouxer item novo.
