# AUTONOMOUS MISSION STATE — Missão Mestre: OmniRoute pronto para o usuário final

- **mission_id:** omniroute-final-user-readiness-v3.8.51
- **objetivo:** auditar e corrigir integralmente o OmniRoute (seguro, estável, instalável, usável por não-técnicos, compatível com Codex/Claude Code/SDKs OpenAI+Anthropic, observável, recuperável, testado, documentado, empacotado, pronto para release) — **sem publicar nada sem autorização**.
- **repositório canônico:** `LMPrado-DZ23/OmniRoute` (renomeado de `lmpradodz23-design`; mesmo repo, histórico preservado). Upstream só para comparação/crédito: `diegosouzapw/OmniRoute`.
- **diretório:** `C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port`
- **branch de trabalho:** `fix/final-user-readiness` (criada de `release/v3.8.51`)
- **HEAD inicial:** `2a156c73812d45119d5a06a2f55d611280442860`
- **HEAD atual:** `fd6d9f61c` (79 commits desde o HEAD inicial — `git log --oneline 2a156c738..HEAD`)
- **estado:** EXECUTING — **Fases 1, 3, 7, 8 concluídas; Fase 5 (onboarding U1–U4, U8) concluída; Fase 2 higiene concluída; Fase 2 confiabilidade R-1…R-9, R-12…R-14 concluídas (R-5/R-8 verificados no código)**; próximo: R-10/R-11 (verificação), R-20 progressivo (bin/cli 5 erros TS), poda de suppressions ESLint → Fase 4 → Fase 5 restante → Fase 6 → Fase 9 → CANDIDATE_COMPLETED
- **iteração:** 9
- **início:** 2026-09-09
- **último_heartbeat:** 2026-09-11 — R-7 commitado (`fd6d9f61c`); `02`/`03` atualizados (R-2…R-9, R-12…R-14, E-6/E-8/E-9)
- **último_progresso_real:** 2026-09-11 — R-2 (transações + artefato órfão), achado novo (chaves importadas de JSON sem `key_hash`), R-3 (retry SQLITE_BUSY), R-12 (grupo de processo + `server.pid`), R-6 (shutdown para schedulers), R-9 (MCP por sessão), R-4 (tolerância condicional), R-14 (sandbox/cap/shutdown do browser pool), R-7 (`AbortSignal.any`)
- **toolchain:** node v24.16.0 · npm 11.13.0 · `node_modules` = junction para o checkout irmão (nunca `npm install` sem `--package-lock-only`)

## Autorizações (desta missão)

- PODE: auditar; branch de correção; modificar código/testes/docs/migrations/workflows/scripts; instalar deps do lockfile; lint/typecheck/testes/build/pack local; commits locais pequenos; subagentes.
- NÃO PODE sem nova confirmação: push; abrir/mesclar PR; publicar npm/Docker/Electron/Release; deploy; apagar dados reais; force push; reescrever histórico; credenciais reais; custos externos; reduzir segurança; enfraquecer testes.
- **Autorização adicional do operador (2026-09-09):** ao **finalizar** auditoria e correções, subir/atualizar o GitHub (open source, imagem, tudo atualizado). Escopo interpretado: **condicional a COMPLETED** (após as 3 auditorias) → push da branch + PR/merge em `origin` = `LMPrado-DZ23/OmniRoute`; repo público; imagem via **GHCR com `GITHUB_TOKEN`** (Docker Hub exigiria token do operador — não digitar credenciais). **Fora:** deploy VPS/produção, npm publish, credenciais reais. Até COMPLETED: **sem push**.
- Chaves de API coladas pelo operador no chat: **recusadas, nunca usadas**; recomendação de rotação registrada.

## Concluído (todos red-first, um problema por commit; status por achado em `02`/`03`/`04`)

| Fase                | Itens                                                                                                                                                                                                                                 | Commits (principais)                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1 §4 SSRF           | S-1…S-7 + trava estrutural                                                                                                                                                                                                            | `33b7f20ee` … `2f5a80e04`                                                           |
| 1 §7 MCP            | M-1, R-10, M-2                                                                                                                                                                                                                        | `0e594e7a6` `482511918` `2ef9671c4`                                                 |
| 1 §1 Electron       | E-1/2/3/7, E-10 HTTPS remoto                                                                                                                                                                                                          | `f90d3e2d0` `a639938bf`                                                             |
| 1 §3/§5/§6/§2       | #5 Try, #7 reveal-once, #3 readiness, #2 matriz (144 células)                                                                                                                                                                         | `7cdf5a0a8` `f9ec8e0ed` `87c4478a5` `ee822b5d6`                                     |
| 5 onboarding        | U1, U2, U3 (causa raiz no servidor), U4, U8, i18n caps-lock                                                                                                                                                                           | `3f524cbdb` `ec4939423` `c3dbff45a` `73e188465` `d2fd682e9` `b3b4ce963`             |
| 8 identidade        | `distribution.ts`, gate npm por `repository.url`, packaging/workflows/scripts, README/docs/skills, 41 espelhos `llm.txt`                                                                                                              | `e32178574` `8c1679002` `2c2826c93`                                                 |
| 7 supply chain      | SC-1 strict + composite, 192 `uses:` → SHA, SC-4 checksums, SC-2/6 digests+pip, SC-7, SC-8, SC-5 deploy exato+identidade, trava `workflows-supply-chain-pins`                                                                         | `58bfa9be8` `8a32fce7f` `9c1284d7a` `19544b0b1` `a4464d112` `ae59709be` `8e6946d1e` |
| deps                | hono → ^4.13.7 (lockfile-only)                                                                                                                                                                                                        | `1aa4df0db`                                                                         |
| 3 plugins           | P-6, P-1/P-4 (`archive.ts`), P-2/P-3 disclosure, P-8; P-5/P-7/SC-3 aceitos com justificativa                                                                                                                                          | `4c710fd9f` `18951837e` `d28d9066b` `9e4a8cb0a` `b40ad2242`                         |
| 2 higiene (Windows) | teardowns EPERM, path separator, `npm.cmd`, CRLF, symlink→cópia, `pathToFileURL`, `where`, qdrant por provedor configurado                                                                                                            | `8ec8324ca` `2b4bd05e0` `94b0d179b`                                                 |
| 2 higiene (vitest)  | split de ambientes + trava; jest-dom; suites cache; mocks next-intl; agent-card; HistoryTab relógio; ComboSortSelect; budgets; ApiEndpointsTab (`t` estável); webhook wizard; locale Intl fixado; **63/63 exclusões #8618 removidas** | `02db987ed` … `b261963c7`                                                           |
| 2 R-1 rollback      | restore point nomeado, handle fechado, snapshot verificado; `docs/ops/DATABASE_GUIDE.md`; **`audit/ROLLBACK.md`**                                                                                                                     | `efa30272e`                                                                         |
| 2 R-2               | `deleteApiKey`/`reorderConnections`/`issueRegisteredKey` em transação; `updateApiKeyPermissions` via `immediate()`; artefato de call-log removido se o INSERT falhar                                                                  | `379333e10` `98dc1757d`                                                             |
| 2 achado novo       | chaves importadas de db.json / Import JSON sem `key_hash`/`key_prefix` **nunca autenticavam** (pré-existente, provado por stash) — `deriveApiKeyStorageFields` + `ensureApiKeysColumns`                                               | `91e9118f5`                                                                         |
| 2 R-3               | retry limitado de `SQLITE_BUSY` (25+50+100+200 ms) nos adapters better-sqlite3 e node:sqlite, só fora de transação; lock segurado por 2.º processo no teste                                                                           | `4eb0918b0`                                                                         |
| 2 R-12/E-6          | `detached` em POSIX + `kill(-pid)`; `DATA_DIR/server.pid`; `reapOrphanServer` com verificação de identidade                                                                                                                           | `36c6aa58f`                                                                         |
| 2 R-6               | shutdown para schedulers antes do drain + `registerShutdownHook()`                                                                                                                                                                    | `8b64ca023`                                                                         |
| 2 R-9               | MCP HTTP por sessão nos dois endpoints; 404 em sessão desconhecida; cap 64                                                                                                                                                            | `86cca0940`                                                                         |
| 2 R-4               | tolerância a `duplicate column name` só com estado final completo                                                                                                                                                                     | `f602bed3d`                                                                         |
| 2 R-14/E-8          | sandbox Chromium mantido; cap de contextos LRU; pool fechado no shutdown                                                                                                                                                              | `07d626b10`                                                                         |
| 2 R-7               | `mergeAbortSignals` via `AbortSignal.any` (sem vazamento de listeners)                                                                                                                                                                | `fd6d9f61c`                                                                         |
| 2 R-5/R-8/R-13      | verificados no código (holdback em `streamRecovery.ts`; watchdog `STREAM_IDLE_TIMEOUT_MS`; `ownerOnlyFile.js` 0o600) — sem mudança                                                                                                    | —                                                                                   |

## Tarefa atual

Ordem 12/13 do plano — fechar a Fase 2: verificar R-10 (`callerId` na auditoria MCP — commit `482511918` da Fase 1 deve cobrir) e R-11 (helper `fetchTimeout` em `server.ts`); R-20 progressivo: corrigir os 5 erros TS de `bin/cli/*.mjs` que o `open-sse/tsconfig.json` reporta e manter baselines (api 289, open-sse 0); poda de suppressions ESLint (`--prune-suppressions`).

## Tarefas pendentes (ordem do plano)

- [ ] 12 · Fase 2: R-10/R-11 verificação; R-15…R-19 (LOW) avaliar custo/benefício e registrar.
- [ ] 13 · Fase 2 tipagem: R-20 progressivo (bin/cli); poda de suppressions ESLint.
- [ ] 14 · Fase 4 guardrails/PII fail-closed; paridade `/v1/chat/completions`, `/v1/messages`, `/v1/responses`.
- [ ] 15 · Fase 5 restante: U5, U6, U7, J2, J13, J17, A1, A2, M1, I1–I3 + docs pt-BR "primeiro uso"; E-5 (snapshot pré-update no Electron — ver `ROLLBACK.md` §2.3).
- [ ] 16 · Fase 6 compatibilidade (Codex, Claude Code, SDKs, MCP, SSE, cancelamento, usage) com instância isolada.
- [ ] 17 · Fase 9 matriz de testes + empacotamento → `TEST_MATRIX.md`; lint completo (`npm run lint` com suppressions).
- [ ] 18 · CANDIDATE_COMPLETED → 3 auditorias independentes → `FINAL_THREE_AGENT_REVIEW.md` → fix loop → COMPLETED → (autorização condicional) push/PR/GHCR.
- [ ] Entregáveis: `FINAL_REPORT`, `TEST_MATRIX`, `SECURITY_REMEDIATION`, `USER_JOURNEYS`, `RELEASE_READINESS` (`ROLLBACK` ✔).

## Falhas pré-existentes — situação

- Todas as falhas do checkpoint anterior corrigidas; 63/63 suites #8618 religadas (UI 363/364 → budget ajustado; MCP 51/51).
- `tests/unit/db-adapters/driverFactory.test.ts`: 29/29 testes passam, mas o processo aborta na saída com `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c` — libuv/Windows no teardown (`--test-force-exit` + handles nativos); **BLOQUEADO POR AMBIENTE** (não ocorre em Linux/CI). Provado igual com e sem as mudanças (stash).
- `tsc -p open-sse/tsconfig.json`: 0 erros em `open-sse/`, **5 em `bin/cli/*.mjs`** (api.mjs:188 ×3, backup.mjs:298, sqlite.mjs:9 `bun:sqlite`) — pré-existentes, alvo do R-20.
- Gate `eslint` completo: suppressions não usadas → `npm run lint` sai 2 até `--prune-suppressions` (ordem 13).
- Produto: números/moeda formatados com o locale do navegador, não com o locale da UI (registrar em `04` como IMPROVEMENT, baixo).

## Blockers

- Internos: nenhum.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: gate de secret scan local (gitleaks ausente) — controle compensatório em todo commit (`git diff --cached --check` + regex de segredos no diff staged); CI/release estrito (SC-1).
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: code-signing Electron (E-4) — certificados do operador.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY` (previstos): smoke autenticado real de `/v1/messages`/`/v1/responses` (credencial + custo — as chaves coladas não serão usadas); push/PR/publish/deploy (condicional a COMPLETED).

## Gates verificados até aqui (exit code real)

| Gate                        | Comando                                                                                                                              | Resultado                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Testes focados por commit   | node:test / vitest por arquivo                                                                                                       | PASS em cada commit (RED observado antes de cada correção)                                |
| UI vitest completo          | `vitest run --config vitest.config.ts` (sem exclusões)                                                                               | 363/364 arquivos · 2363/2364 testes (única falha = timeout de transform, budget ajustado) |
| MCP vitest completo         | `vitest run --config vitest.mcp.config.ts`                                                                                           | 51/51 · 468/468                                                                           |
| Regressões por área         | migrations/backup 61+54; api-keys/registered/reorder 106; call-logs 46; electron 92; executors/stream 110; MCP transport 8 + 32      | PASS                                                                                      |
| ESLint (arquivos tocados)   | `eslint --max-warnings=0 --suppressions-location config/quality/eslint-suppressions.json --pass-on-unpruned-suppressions <arquivos>` | 0                                                                                         |
| Prettier (arquivos tocados) | `prettier --write`                                                                                                                   | aplicado                                                                                  |
| api-typecheck baseline      | `scratchpad/_apitc.mjs` (mesmo parser/diff do `check-api-typecheck.mjs`, que não consegue spawnar `tsc` no Windows)                  | 289 = baseline, 0 regressões                                                              |
| tsc core / open-sse         | `tsc -p tsconfig.typecheck-core.json` / `tsc -p open-sse/tsconfig.json`                                                              | 0 / 0 fora de `bin/`                                                                      |
| test-discovery              | `node scripts/check/check-test-discovery.mjs`                                                                                        | OK (0 órfãos novos)                                                                       |
| docs-sync                   | `node scripts/check/check-docs-sync.mjs`                                                                                             | PASS                                                                                      |
| Dependency scan (prod)      | `npm audit --omit=dev --json`                                                                                                        | 0 critical · 0 high · 3 moderate (cadeia `adm-zip`/onnxruntime, aceita)                   |
| Secret scan local           | gitleaks                                                                                                                             | **NOT_RUN** (binário ausente)                                                             |

## Processos / portas

- PID **8488** escuta 20128/20131/20132 = instância de teste do operador (NÃO encerrar).
- Instâncias da missão: nenhuma ativa. Regra: bind 127.0.0.1, porta isolada, `DATA_DIR` temporário, PID registrado, encerrar árvore e confirmar porta livre.

## Riscos

- Escopo amplo → uma fase por vez, um problema por commit, checkpoint a cada progresso.
- `ignoreBuildErrors` esconde erros TS reais → baselines por pacote travam regressão; remoção progressiva (R-20).
- Windows: junction do `node_modules`; CRLF gera falso "drift"; EPERM de `rmSync` com SQLite aberto (fechar antes); transform frio lento no vitest; scratchpad pode ser limpo ao retomar (helpers `_apitc.mjs`/mensagens de commit são recriáveis).

## Próxima ação

1. Commit `docs(audit): checkpoint — Fase 2 confiabilidade R-2…R-14` (este arquivo + `02` + `03`).
2. R-10/R-11 verificação; R-20: `bin/cli` 5 erros; `--prune-suppressions`.
3. Fase 4 (guardrails/PII fail-closed; paridade dos três endpoints).

## Instruções de retomada

1. `cd C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port && git status --short --branch && git rev-parse HEAD`
2. Confirmar branch `fix/final-user-readiness` e `origin` = `LMPrado-DZ23/OmniRoute`.
3. Ler este arquivo e `audit/0*.md` + `audit/ROLLBACK.md`; comparar com o estado real; retomar da tarefa pendente mais alta.
4. Nunca `reset --hard`; nunca push sem autorização; nunca usar credenciais coladas no chat; nunca `npm install` sem `--package-lock-only` (junction).
