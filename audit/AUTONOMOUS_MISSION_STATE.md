# AUTONOMOUS MISSION STATE — Missão Mestre: OmniRoute pronto para o usuário final

- **mission_id:** omniroute-final-user-readiness-v3.8.51
- **objetivo:** auditar e corrigir integralmente o OmniRoute (seguro, estável, instalável, usável por não-técnicos, compatível com Codex/Claude Code/SDKs OpenAI+Anthropic, observável, recuperável, testado, documentado, empacotado, pronto para release) — **sem publicar nada sem autorização**.
- **repositório canônico:** `LMPrado-DZ23/OmniRoute` (renomeado de `lmpradodz23-design`; mesmo repo, histórico preservado). Upstream só para comparação: `diegosouzapw/OmniRoute`.
- **diretório:** `C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port`
- **branch de trabalho:** `fix/final-user-readiness` (criada de `release/v3.8.51`)
- **HEAD inicial:** `2a156c73812d45119d5a06a2f55d611280442860`
- **HEAD atual:** `2a156c73812d45119d5a06a2f55d611280442860`
- **estado:** EXECUTING (Fase 1 — Segurança P0; Fase 0 concluída)
- **iteração:** 2
- **início:** 2026-09-09
- **último_heartbeat:** 4 auditores read-only em execução (segurança delegou 3 sub-auditorias e vai consolidar); baselines de gates coletados
- **último_progresso_real:** Fase 1 baseline 64/64 PASS (exit 0); `npm audit` prod 0 critical/0 high; `01-CURRENT-STATE.md` escrito; 2 achados preliminares de supply chain registrados
- **toolchain:** node v24.16.0 · npm 11.13.0

## Missão anterior (referência, não repetir)
`omniroute-sec-remediation-v3.8.51` — COMPLETED. Os 8 findings do scan (SSRF webhook, LOCAL_ONLY LAN, encrypt fail-open, MCP scopes, OpenAPI Try, Electron IPC, api keys plaintext, webhook secret) foram corrigidos com testes e mergeados em `release/v3.8.51` (PRs #3/#4 + fix sanitizador `12cacb538` + cloud-agents `2a156c738`). Esta missão **revalida** cada um no código atual (Fase 1) e amplia para Fases 2–9.

## Autorizações (desta missão)
- PODE: auditar; branch de correção; modificar código/testes/docs/migrations/workflows/scripts; instalar deps do lockfile; lint/typecheck/testes/build/pack local; commits locais pequenos; subagentes.
- NÃO PODE sem nova confirmação: push; abrir/mesclar PR; publicar npm/Docker/Electron/Release; deploy; apagar dados reais; force push; reescrever histórico; credenciais reais; custos externos; reduzir segurança; enfraquecer testes.

## Tarefa atual
Fase 1 §2.1 — SSRF outbound (S-1 dispatcher de produção → `hardenedWebhookFetch`; S-2 portar 4 bypasses do relay para `privateHost.ts` canônico e colapsar cópias; S-3/S-4/S-5/S-6 guards). Um problema por commit, com teste de regressão. Fase 0 concluída: `audit/01…05` escritos (adendos pendentes dos auditores de arquitetura/segurança/qualidade serão anexados).

## Tarefas concluídas
- [x] Recuperação: checkpoint anterior lido; git/HEAD/diff/processos conferidos; missão anterior reconhecida como concluída.
- [x] Identidade do checkout: diretório, status, remotes, HEAD, branch, node/npm registrados.
- [x] `origin` = `LMPrado-DZ23/OmniRoute` (rename não-destrutivo; upstream preservado como `upstream`).
- [x] Branch `fix/final-user-readiness` criada de `release/v3.8.51` @ `2a156c738`.

## Tarefas pendentes
- [x] Fase 0: 5 docs de auditoria escritos (`01-CURRENT-STATE`, `02-ARCHITECTURE`, `03-SECURITY-FINDINGS`, `04-PRODUCT-GAPS`, `05-EXECUTION-PLAN`); pendentes só adendos (arquivos gigantes; números de lint/TS; adendo do auditor-pai de segurança).
- [ ] Fase 1: revalidar os 8 P0 no código atual (esperado: CORRIGIDO NO CÓDIGO ATUAL; corrigir residual).
- [ ] Fase 2: arquitetura/confiabilidade (remover `ignoreBuildErrors` next.config:383, TS estrito progressivo, god-files, lifecycle de subprocessos).
- [ ] Fase 3: plugins/marketplace (extração tar.gz segura, traversal, symlink, bomb, checksum, aviso de código confiável).
- [ ] Fase 4: guardrails obrigatórios/PII fail-closed; alinhar /v1/chat/completions, /v1/messages, /v1/responses.
- [ ] Fase 5: jornadas do usuário final (17 passos) + WCAG AA.
- [ ] Fase 6: compatibilidade de clientes (Codex, Claude Code, SDKs, MCP, SSE).
- [ ] Fase 7: CI/CD supply chain (Actions em SHA, scanners fixos, SBOM, deploy digest-pinned — sem deploy).
- [ ] Fase 8: identidade do fork (updater, packages, badges, docker metadata) → `LMPrado-DZ23/OmniRoute`.
- [ ] Fase 9: matriz de testes + empacotamento (sequencial, portas isoladas, DATA_DIR temporário, PID registrado).
- [ ] CANDIDATE_COMPLETED → 3 auditorias independentes → `FINAL_THREE_AGENT_REVIEW.md` → fix loop → COMPLETED.
- [ ] Entregáveis: FINAL_REPORT, TEST_MATRIX, SECURITY_REMEDIATION, USER_JOURNEYS, RELEASE_READINESS, ROLLBACK.

## Blockers
- Internos: nenhum.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: **gate de secret scan** — não há gitleaks nem scanner de segredo em `node_modules`; obter o binário exige download externo (pede permissão do operador). Até lá: secret scan = `NOT_RUN`; controle compensatório = varredura regex do diff staged antes de cada commit (não substitui o gate).
- `BLOCKED_BY_EXTERNAL_DEPENDENCY` (previstos): smoke autenticado real de `/v1/messages` e `/v1/responses` (credencial + custo); push/PR/publish/deploy (autorização). Tudo que não depende disso continua.

## Achados preliminares (coletados pelo executor antes da consolidação dos auditores)
- **SC-1 (HIGH, Fase 7):** `scripts/check/check-secrets.mjs` é advisory por padrão e, mesmo com `--ratchet`, sai 0 quando o binário está ausente ("falta de infraestrutura nunca bloqueia"). Viola "scanner ausente deve falhar o gate de release".
- **SC-2 (MEDIUM, Fase 7):** `.github/workflows/ci.yml:348-358` baixa gitleaks via `gh release download` sem versão/checksum fixos (**latest**). Viola "remover downloads de latest; fixar versões e checksums dos scanners".
- **SC-3 (MEDIUM, Fase 7):** advisory `adm-zip` (extração segue symlink) via `onnxruntime-node`. **Resolvido pela sub-auditoria:** `adm-zip` NÃO participa de plugins/marketplace (não existe extração de arquivo em `src/`) → permanece MEDIUM, só cadeia ONNX.

Sub-auditoria RCE/traversal/plugins (evidência para `03-SECURITY-FINDINGS.md`, Fase 3):
- **P-0 (positivo):** nenhuma injeção de comando reachable (todos os spawn são argv-array; sem `exec()` string; sem `new Function`/`eval` em `src/`); nenhum path traversal reachable (`plugins/manager.ts:79-100,456` faz `realpath`+containment correto); `routeGuard.ts:32-83` loopback-gate TODAS as superfícies de spawn/exec antes do auth (espelhado em `spawnCapablePrefixes.ts`).
- **P-1 (MEDIUM-HIGH):** `src/lib/plugins/marketplace.ts:234` — checksum **opcional** (`if (entry.checksum)`); registro (`settings.pluginMarketplaceUrl`, `:151`) fornece URL e hash → pode omitir. Sem assinatura de publisher. `loader.ts:165-181` integrity também opcional. Fix: checksum obrigatório + assinatura.
- **P-2 (MEDIUM):** permissões do manifesto (`manifest.ts:11`: network/file-read/file-write/exec) **não são enforcement** — só `env` é aplicada (`loader.ts:211,419-436`). Fix: aplicar via Node permission model no filho ou parar de anunciar + disclosure obrigatório na UI/docs ("plugins executam código confiável com privilégios do processo").
- **P-3 (MEDIUM):** plugin roda em `spawn(process.execPath, [...])` (`loader.ts:224`) sem `--permission` → autoridade total (fs/net/child_process). Isolamento só de processo.
- **P-4 (BUG funcional):** `installMarketplacePlugin` grava `plugin.tar.gz` (`marketplace.ts:223,244`) e `pluginManager.install(tmpDir)` faz `cp` recursivo do tarball **não extraído** (`manager.ts:191`) → validação do manifesto falha → instalação por marketplace é **não-funcional**. Fix: implementar extração segura (tar-slip/symlink/bomb/limites) ou desabilitar com mensagem clara. (Boa higiene existente: host script `wx`+`0o600`+UUID fecha TOCTOU, `loader.ts:186-208`.)
- **P-5 (MEDIUM, operador-only):** `src/lib/middleware/registry.ts:118,132` — hooks executam `vm.Script` in-process (documentado como não-boundary; sandbox sem `process/require/fetch`, `codeGeneration:false`, timeout) — escape por prototype-chain ainda possível; rota loopback-gated (`routeGuard.ts:58`).
- **P-6 (LOW):** `src/app/api/files/[id]/content/route.ts:29-30` — `Content-Disposition` interpola `filename` sem escape (spoofing de header, não traversal).
- **P-7 (LOW, defesa em profundidade):** `src/lib/acp/registry.ts:322-334` — branch `shell: true` no win32 com `binary` do request; denylist de metacaracteres (`:201`) + `requireBinaryMatch` (`:302-310`) + allowlist de args (`:209,:314`) neutralizam; remover o `shell:true`.
- **P-8 (INFO):** `skills/install/route.ts:19` `handlerCode` nunca é compilado/avaliado (usado só como chave de Map, `executor.ts:245-259`) — campo latente enganoso.

Sub-auditoria SSRF outbound (evidência para `03-SECURITY-FINDINGS.md`, **Fase 1 prioridade máxima** — a remediação #1 anterior cobriu só o `/test`):
- **S-1 (HIGH, residual do finding #1):** `src/lib/webhookDispatcher.ts:45,:78` valida só o hostname (`parseAndValidateWebhookUrl`, sem DNS) e `:49,:101` fazem `fetch` sem `redirect` (default follow) → DNS rebinding e 302→`169.254.169.254` abertos no caminho **de produção**; `deliverWebhook` retenta 4× (`:94`) e devolve `res.status`/`res.ok` ao log = oráculo de blind-SSRF; branch Telegram (`:187-190`) → `deliverRaw` → mesmo fetch. Fix: rotear pelo `hardenedWebhookFetch` (já existe) ou `redirect:"manual"` + validação por IP resolvido e por hop.
- **S-2 (HIGH):** `src/shared/network/privateHost.ts:50-56,:93-100` (`isPrivateHost` canônico) — bypasses: ponto final (`localhost.`, `metadata.google.internal.`), IPv4-compatible `::127.0.0.1`/`::7f00:1`, `fe80::/10` só cobre prefixo `fe80:` (perde `feb0::`), literais decimal/octal/hex seguros só porque callers passam `new URL().hostname`. A cópia `src/lib/proxyRelay/privateHostname.ts:18-67` **já corrige os 4** (teste `tests/unit/relay-private-host-guard-gaps.test.ts:31`); 3ª cópia em `src/lib/db/upstreamProxy.ts:70`. Fix: portar os 4 para o canônico + colapsar as 3 cópias + teste.
- **S-3 (HIGH):** `src/lib/gamification/servers.ts:74,:136,:172` — URL de `community_servers` (`POST /api/gamification/servers`, `route.ts:32` só `z.string().url()`) sem guard; corpo remoto é parseado e mesclado no leaderboard (reflexão).
- **S-4 (HIGH):** `src/app/api/auth/oidc/login/route.ts:49`, `callback/route.ts:106` — `settings.oidcIssuer` sem guard; `callback:132` POSTa `client_secret` ao `token_endpoint` tirado **verbatim** do JSON de discovery (`:114-115`) → exfiltração de credencial para host escolhido pelo issuer.
- **S-5 (MEDIUM-HIGH):** `src/lib/obsidian/api.ts:70,:356` (`baseUrl` de `POST /api/settings/obsidian`, corpo devolvido ao dashboard); `src/lib/memory/qdrant.ts:177` (`settings.qdrantHost`); ambos sem guard.
- **S-6 (MEDIUM):** `src/lib/memory/genericBackend.ts:269` (guard próprio só p/ IP literal, `:62-73`); `src/app/api/translator/send/route.ts:99`; `src/app/api/v1/rerank/route.ts:183,:202`; `src/lib/agentSkills/catalog.ts:207` (`rawUrl`, `schemas.ts:16`); `src/lib/versionManager/healthMonitor.ts:17`; `notion/api.ts:101`, `telegram/botApi.ts:56`, `cloudAgent/agents/{cursor:80,codex:35,devin:29}` — todos sem guard, redirect seguido.
- **Limpos (verificado):** `openapi/try:126` (same-origin `:81` + denylist `:96`), `traffic-inspector replay:43`, `skills/marketplace:44`, `localHealthCheck:118`, `playground/improve-prompt:85`; `safeOutboundFetch.ts` e `providers/validation/transport.ts:111` (revalida `Location`) são sólidos — herdam só as gaps de S-2.

Sub-auditoria CI/supply chain (Fase 7; paths em `.github/workflows/`):
- **SC-4 (HIGH):** `ci.yml:361` `bash <(curl …/rhysd/actionlint/main/…)` pipe-to-shell de branch mutável sem checksum; `ci.yml:349-382` `gh release download` **sem tag (latest)** p/ gitleaks, osv-scanner, oasdiff; `ci.yml:933` `npm install -g bun` sem versão. **Forma correta já existe em `quality.yml:224-233`** (gitleaks v8.30.1, osv v2.3.8, actionlint v1.7.12, zizmor 1.25.2, oasdiff v1.19.1) → replicar.
- **SC-5 (HIGH):** `deploy-vps.yml:59` `npm install -g omniroute@latest` no VPS (missão: nunca `@latest`; propagar versão+digest); `:47` `appleboy/ssh-action@v1` (tag mutável) recebe `VPS_SSH_KEY`. (Deploy não será executado nesta missão; corrigir o workflow.)
- **SC-6 (MEDIUM):** `ci.yml:476` `errata-ai/vale-action@reviewdog` = ref de branch mutável com `GITHUB_TOKEN`; `semgrep.yml:19` `image: semgrep/semgrep` sem tag/digest; `docker-publish.yml:482` `anchore/sbom-action@v0` flutuante; `dast-smoke.yml:68`, `nightly-schemathesis.yml:44` `pip install schemathesis` e `nightly-llm-security.yml:102` `pip install garak` sem versão.
- **SC-7 (MEDIUM):** `wiki-sync.yml:40` e `nightly-release-green.yml:378` — checkout sem `persist-credentials:false` em jobs com `contents: write`.
- **SC-8 (MEDIUM, Docker):** `Dockerfile:2` `node:26-trixie-slim` só tag (sem digest); `Dockerfile:44` `npm install -g npm@latest`; `Dockerfile.bun:2` `oven/bun:1.4.0-slim` sem digest; compose: imagens por tag, não digest; sem `secrets:` blocks (só `.env`); sem `read_only`/`cap_drop`. Positivo: `USER node`/`USER bun` no fim; globais do CLI pinados (`Dockerfile:342-346`).
- **SC-9 (LOW):** `scripts/build/postinstall.mjs:170` `node-pre-gyp install` baixa binário na instalação (rede em install-time); `flake.nix:26-29` shellHook usa `npm install` (não `npm ci`).
- **SC-10 (LOW):** `src/lib/system/autoUpdate.ts:288,297-310` interpola `latest` sem `shellQuote` no script; branch compose (`route.ts:151`) chama antes do `SERVICE_VERSION_PATTERN` (`:319`). Fonte = dist-tag npm (exige comprometer registry), mas fechar é barato.
- **SC-11 → FALSO POSITIVO (verificado via `gh api`):** `actions/checkout@v7`→`3d3c42e5aac5`, `setup-node@v7`→`820762786026`, `upload-artifact@v7`→`043fb46d1a93`, `download-artifact@v8`→`3e5f45b2cfb9`, `cache@v6`→`55cc8345863c`, `github-script@v9`→`373c709c6911` — **todas existem**; `ci.yml:38` já usa o SHA de `checkout@v7`. O sub-auditor tinha conhecimento desatualizado. Na Fase 7, auditar linha a linha quais `uses:` são SHA vs tag (misto). Positivo: `codeql.yml`/`semgrep.yml` (actions) SHA-pinados; Trivy SHA-pinado; `npm-publish.yml` npm@11.15.0 + `--ignore-scripts`; nenhum `pull_request_target`; inputs via `env:`.

Arquitetura (interim do auditor; consolidação final pendente): `ignoreBuildErrors: true` desde o commit inicial v1.0.0 (`71d14209a`); **5.146 warnings ESLint suprimidos em 1.050 arquivos**; `electron/*.js` sem `@ts-check`; `bin/` sem tsconfig. → Fase 2 (remoção progressiva por pacote).

Sub-auditorias MCP/roteamento/jobs e DB/migrations recebidas → consolidadas em `audit/02-ARCHITECTURE.md` (R-1…R-20). Destaques: **R-1** sem rollback de migration (gate rollback = NOT_RUN); **R-2** 6 escritas críticas sem transação; **R-3** sem retry SQLITE_BUSY; **R-5** sem guard de stream-já-iniciado no fallback; **R-6** sem SIGTERM/SIGINT + sem eleição de líder; **R-9** transporte SSE do MCP singleton. **M-1 → CONFIRMADO (HIGH, residual do #4):** SDK popula `extra._meta` de `request.params._meta` (`@modelcontextprotocol/sdk/dist/esm/shared/protocol.js:321`); rota MCP aceita cookie (`apiAuth.ts:227-242`) mas `resolveMcpCallerAuthInfo` só lê API key (`httpAuthContext.ts:57`) → sessão logada sem `authInfo` → `_meta:["*"]` libera tudo; stdio e chave com `scopes:[]` idem; teste `t08-mcp-scope-enforcement.test.ts:27-39` consagra o fallback (trocar asserção = fortalecer). `*` bare concede tudo (`:76-85`).

**`audit/03-SECURITY-FINDINGS.md` escrito** (revalidação dos 8 contra a régua da missão: #2 e #8 CORRIGIDO; #1,#3,#4,#5,#6,#7 CORRIGIDO-PARCIAL com residuais S-1/S-2, E-7, M-1, cookie+mutáveis, E-1/E-2/E-3, reveal reutilizável). Falta na Fase 0: `05-EXECUTION-PLAN.md` (aguarda auditor de qualidade p/ lint/format/TS) e adendo de arquivos gigantes em `02`.

Produto/UX: auditor **concluído** → consolidado em `audit/04-PRODUCT-GAPS.md`. HIGHs: **U1** onboarding `errorMessage` nunca renderizado (`onboarding/page.tsx:84`); **J15** updater/version-check apontam ao upstream (`electron/package.json:53-57`, `versionCheck.ts:28,36`). Mapa de ~110 refs `diegosouzapw` (corrigir vs manter) registrado no doc.

Sub-auditoria Electron / updater / rollback (residuais do finding #6 + Fase 5/8):
- **E-1 (HIGH, residual #6):** `electron/lib/ipcOriginGuard.js:68-82` `isCrossOriginNavigation` exportado e empacotado mas **nunca ligado a `will-navigate`** em `main.js` (só `isPrivilegedSenderAllowed` importado, `:41`) → bloqueio de navegação cross-origin documentado é inerte.
- **E-2 (HIGH, residual #6):** guard de origem aplicado só em `login:start` (`main.js:1072`); no modo Remote Server, `restart-server` (`:1010`), `download-update`/`install-update` (`:1042-1056`), `enable-autostart` (`:1127`), `get-data-dir`, `open-external` seguem invocáveis pela origem remota.
- **E-3 (MEDIUM, residual #6):** `sandbox` não setado na janela principal (`main.js:403-409`; só na prompt remota `:639`). Preload único compartilhado (`preload.js:93-119` allowlist de canais) — missão pede preload separado/mínimo.
- **E-4 (HIGH, release):** `electron/package.json` sem configuração de code-signing (win cert, mac hardenedRuntime/notarize, forceCodeSigning) → `electron-updater` sem identidade de publisher para verificar; updates confiam só em TLS+manifest GitHub. (Assinatura via CI não verificada.)
- **E-5 (HIGH, Fase 5 backup/rollback):** sem rollback no desktop: sem backup do `storage.sqlite` pré-update, `allowDowngrade` não setado, sem health-gate pós-install (`main.js:334-339` mata servidor e `quitAndInstall`). CLI `bin/cli/commands/update.mjs:59-81` "backup" copia só `bin/` (não restaurável); `:224` instala `omniroute@latest`; `:49-57` `compareVersions` ignora prerelease. `autoUpdate.ts:295-364` cria branch git pré-update mas sem backup de DB/auto-revert.
- **E-6 (MEDIUM):** POSIX: servidor spawnado sem `detached` (`main.js:834`), então `SIGTERM` em `processTree.js:56` não alcança netos (MITM, túneis) — contradiz o comentário `:54-55`; Windows coberto por `taskkill /T`. Sem watchdog/PID file se o main morrer.
- **E-7 (MEDIUM):** `main.js:794` grava `server.env` (JWT/API_KEY/STORAGE_ENCRYPTION) em plaintext sem restringir modo do arquivo. Positivo: `:761-771` recusa gerar nova `STORAGE_ENCRYPTION_KEY` se DB já tem `enc:v1:`.
- **E-8 (MEDIUM):** `packages/browser-pool/src/services/browserPool.ts:169-181` `--no-sandbox` nos dois caminhos de launch; sem cap de contextos (`:250-347`); sem hook de saída do processo.
- **E-9 (Fase 8):** `electron/package.json:53-57` `build.publish` → GitHub `diegosouzapw/OmniRoute` (updater aponta pro upstream). Corrigir para `LMPrado-DZ23/OmniRoute`.
- Positivos: `loginManager.js:115-126` janela de login sem preload, partition efêmera, credenciais persistidas só no main (`main.js:1086-1088`) e nunca devolvidas ao renderer; `contextIsolation:true`, `nodeIntegration:false`, `webviewTag:false`.

## Processos / portas
- PID **8488** escuta 20128/20131/20132 = **instância de teste do operador** (não é órfão da missão; NÃO encerrar).
- Instâncias de teste da missão: nenhuma ativa. Regra: bind 127.0.0.1, porta isolada, `DATA_DIR` temporário, PID registrado, encerrar árvore e confirmar porta livre ao fim.

## Evidência real mais recente
- Fase 1 baseline @ `2a156c738`: 64/64 PASS, exit 0 (SSRF webhook, LOCAL_ONLY, encryptOrThrow, secrets, webhook secret, apikey-at-rest, electron IPC guard, MCP scopes default, OpenAPI Try, sanitizador).
- `audit/01-CURRENT-STATE.md` criado (untracked; será commitado com os demais docs da Fase 0).
- `git status --short --branch` → só arquivos novos em `audit/` (untracked) em `fix/final-user-readiness`; nenhum arquivo rastreado modificado.
- Repo: 170 migrações · 697 rotas API · 4335 testes unitários · 190 scripts npm · `next.config` `ignoreBuildErrors: true` (L383) · 26 workflows · Electron + Docker presentes.

## Testes executados (esta missão)
| Gate | Comando | Exit | Resultado |
|---|---|---|---|
| Fase 1 baseline (8 findings + sanitizador) | `node --import tsx/esm --test --test-concurrency=1 <10 arquivos>` @ `2a156c738` | 0 | **64/64 PASS** |
| Dependency scan (prod) | `npm audit --omit=dev --json` | 1 (por advisories) | **0 critical · 0 high · 4 moderate** → gate Critical/High = PASS |
| Secret scan | `node scripts/check/check-secrets.mjs` | 0 | **NOT_RUN** — `SKIP reason=binary-absent` (gitleaks ausente; script sai 0 = falso verde) |

4 moderate: `@huggingface/transformers`→`onnxruntime-node`→`adm-zip` (GHSA-vwc7-r8mq-g2x9, extração segue symlink; fix = downgrade semver-major, avaliar) e `hono` ≤4.13.4 (GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc; **fix disponível sem major**).

## Commits (esta missão)
- Nenhum ainda.

## Riscos
- Escopo amplo → controlar por fase, um problema por commit, checkpoint após cada progresso.
- `ignoreBuildErrors` esconde erros TS reais → remoção pode expor volume grande; fazer progressivo por pacote.
- Windows: junction do `node_modules` quebra Turbopack (usar `OMNIROUTE_USE_TURBOPACK=0`); CRLF gera falso "drift" no gerador de skills (git diff é a verdade).

## Próxima ação
1. Commit local `docs(audit): Fase 0` (sem push). 2. Fase 1 §2.1 S-1: ler `src/lib/webhookDispatcher.ts`, escrever teste de regressão (redirect→privado, rebinding, oráculo de status), rotear pelo `hardenedWebhookFetch`, rodar testes focados + `webhook-*`, secret sweep, `git diff --check`, commit `fix(webhooks): harden production delivery against SSRF`. 3. S-2 idem em `privateHost.ts`.

## Instruções de retomada
1. `cd C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port && git status --short --branch && git rev-parse HEAD`
2. Confirmar branch `fix/final-user-readiness` e `origin` = LMPrado-DZ23.
3. Ler este arquivo; conferir `audit/0*.md` existentes; comparar com o estado real; retomar da tarefa pendente mais alta.
4. Nunca `reset --hard`; nunca push sem autorização.
