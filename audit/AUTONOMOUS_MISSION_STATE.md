# AUTONOMOUS MISSION STATE — Missão Mestre: OmniRoute pronto para o usuário final

- **mission_id:** omniroute-final-user-readiness-v3.8.51
- **objetivo:** auditar e corrigir integralmente o OmniRoute (seguro, estável, instalável, usável por não-técnicos, compatível com Codex/Claude Code/SDKs OpenAI+Anthropic, observável, recuperável, testado, documentado, empacotado, pronto para release) — **sem publicar nada sem autorização**.
- **repositório canônico:** `LMPrado-DZ23/OmniRoute` (renomeado de `lmpradodz23-design`; mesmo repo, histórico preservado). Upstream só para comparação/crédito: `diegosouzapw/OmniRoute`.
- **diretório:** `C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port`
- **branch de trabalho:** `fix/final-user-readiness` (criada de `release/v3.8.51`)
- **HEAD inicial:** `2a156c73812d45119d5a06a2f55d611280442860`
- **HEAD atual:** `b40ad2242` (56 commits desde o HEAD inicial — `git log --oneline 2a156c738..HEAD`)
- **estado:** EXECUTING — **Fases 1, 3, 7, 8 concluídas; Fase 5 (onboarding U1–U4, U8) concluída**; próximo: ordem 12–13 do plano (Fase 2 confiabilidade/DB + higiene de testes + tipagem), depois Fase 4, Fase 5 restante, Fase 6, Fase 9, CANDIDATE_COMPLETED
- **iteração:** 7
- **início:** 2026-09-09
- **último_heartbeat:** 2026-09-10 — P-8 commitado (`b40ad2242`); docs `03`/`04` com status por achado
- **último_progresso_real:** 2026-09-10 — Fase 3 (P-1/P-4 extração segura + checksum obrigatório, P-2/P-3 disclosure, P-6, P-8), Fase 7 (SC-1/2/4/5/6/7/8, 192 actions em SHA), Fase 8 (identidade: código, packaging, workflows, README/docs/llm.txt), hono
- **toolchain:** node v24.16.0 · npm 11.13.0 · `node_modules` = junction para o checkout irmão (nunca `npm install` sem `--package-lock-only`)

## Autorizações (desta missão)
- PODE: auditar; branch de correção; modificar código/testes/docs/migrations/workflows/scripts; instalar deps do lockfile; lint/typecheck/testes/build/pack local; commits locais pequenos; subagentes.
- NÃO PODE sem nova confirmação: push; abrir/mesclar PR; publicar npm/Docker/Electron/Release; deploy; apagar dados reais; force push; reescrever histórico; credenciais reais; custos externos; reduzir segurança; enfraquecer testes.
- **Autorização adicional do operador (2026-09-09):** ao **finalizar** auditoria e correções, subir/atualizar o GitHub (open source, imagem, tudo atualizado). Escopo interpretado: **condicional a COMPLETED** (após as 3 auditorias) → push da branch + PR/merge em `origin` = `LMPrado-DZ23/OmniRoute`; repo público; imagem via **GHCR com `GITHUB_TOKEN`** (Docker Hub exigiria token do operador — não digitar credenciais). **Fora:** deploy VPS/produção, npm publish, credenciais reais. Até COMPLETED: **sem push**.
- Chaves de API coladas pelo operador no chat: **recusadas, nunca usadas**; recomendação de rotação registrada.

## Concluído (todos red-first, um problema por commit; status por achado em `03`/`04`)
| Fase | Itens | Commits (principais) |
|---|---|---|
| 1 §4 SSRF | S-1…S-7 + trava estrutural | `33b7f20ee` … `2f5a80e04` |
| 1 §7 MCP | M-1, R-10, M-2 | `0e594e7a6` `482511918` `2ef9671c4` |
| 1 §1 Electron | E-1/2/3/7, E-10 HTTPS remoto | `f90d3e2d0` `a639938bf` |
| 1 §3/§5/§6/§2 | #5 Try, #7 reveal-once, #3 readiness, #2 matriz (144 células) | `7cdf5a0a8` `f9ec8e0ed` `87c4478a5` `ee822b5d6` |
| 5 onboarding | U1, U2, U3 (causa raiz no servidor), U4, U8, i18n caps-lock | `3f524cbdb` `ec4939423` `c3dbff45a` `73e188465` `d2fd682e9` `b3b4ce963` |
| 8 identidade | `distribution.ts`, gate npm por `repository.url`, packaging/workflows/scripts, README/docs/skills, 41 espelhos `llm.txt` | `e32178574` `8c1679002` `2c2826c93` |
| 7 supply chain | SC-1 strict + composite, 192 `uses:` → SHA, SC-4 checksums, SC-2/6 digests+pip, SC-7, SC-8, SC-5 deploy exato+identidade, trava `workflows-supply-chain-pins` | `58bfa9be8` `8a32fce7f` `9c1284d7a` `19544b0b1` `a4464d112` `ae59709be` `8e6946d1e` |
| deps | hono → ^4.13.7 (lockfile-only) | `1aa4df0db` |
| 3 plugins | P-6, P-1/P-4 (`archive.ts`), P-2/P-3 disclosure, P-8; P-5/P-7/SC-3 aceitos com justificativa | `4c710fd9f` `18951837e` `d28d9066b` `9e4a8cb0a` `b40ad2242` |

## Tarefa atual
Ordem 12 do plano — **Fase 2 confiabilidade/DB + higiene de testes**: começar pela higiene que já foi provada (teardowns EPERM no Windows, path separator em `electron-resolve-server-entry`, `npm.cmd` em `cli-update-prefer-online-4376`, `radar-export` ESM URL scheme, `qdrant-routes` embedding-models, `version-manager` symlink EPERM, `proxy-fallback-ssrf` teardown, `check-workflows` 2 falhas, 63 testes mascarados no `vitest.config.ts` #8618), depois R-1 rollback (+ `ROLLBACK.md`), R-2 transações, R-3 SQLITE_BUSY, R-5, R-6, R-9, R-12/13/14; R-20 tipagem progressiva.

## Tarefas pendentes (ordem do plano)
- [ ] 12 · Fase 2 confiabilidade/DB + higiene de testes (acima).
- [ ] 13 · Fase 2 tipagem: R-20 progressivo; poda de suppressions ESLint não usadas (`--prune-suppressions`, tornadas obsoletas pelas correções desta missão).
- [ ] 14 · Fase 4 guardrails/PII fail-closed; paridade `/v1/chat/completions`, `/v1/messages`, `/v1/responses`.
- [ ] 15 · Fase 5 restante: U5, U6, U7, J2, J13, J17, A1, A2, M1, I1–I3 + docs pt-BR "primeiro uso".
- [ ] 16 · Fase 6 compatibilidade (Codex, Claude Code, SDKs, MCP, SSE, cancelamento, usage) com instância isolada.
- [ ] 17 · Fase 9 matriz de testes + empacotamento → `TEST_MATRIX.md`; lint completo (`npm run lint` com suppressions).
- [ ] 18 · CANDIDATE_COMPLETED → 3 auditorias independentes → `FINAL_THREE_AGENT_REVIEW.md` → fix loop → COMPLETED → (autorização condicional) push/PR/GHCR.
- [ ] Entregáveis: `FINAL_REPORT`, `TEST_MATRIX`, `SECURITY_REMEDIATION`, `USER_JOURNEYS`, `RELEASE_READINESS`, `ROLLBACK`.

## Falhas pré-existentes provadas (via `git stash` no HEAD sem a alteração) — Fase 2 higiene, NÃO tocadas ainda
- `tests/integration/qdrant-routes.test.ts` embedding-models ×3.
- `tests/unit/version-manager*.test.ts` "rolls back" — EPERM `symlinkSync` no Windows.
- `tests/unit/proxy-fallback-ssrf.test.ts`, `api-key-lifecycle`, `api-key-regeneration` — EPERM de teardown (`rmSync` com SQLite aberto).
- `tests/unit/electron-resolve-server-entry.test.ts` — separador de caminho Windows.
- `tests/unit/cli-update-prefer-online-4376.test.ts` — espera cmd `npm`, `npmBin()` devolve `npm.cmd` no Windows.
- `tests/unit/radar-export.test.mjs` ×3 — `ERR_UNSUPPORTED_ESM_URL_SCHEME` (import por caminho absoluto Windows).
- `tests/unit/build/check-workflows.test.ts` ×2 — `isBinaryAvailable` usa `which`; asserção "#7307 quality.yml advisory build".
- Gate `eslint` completo: suppressions agora não usadas (arquivos corrigidos) → `npm run lint` sai 2 até `--prune-suppressions` (Fase 2/9).

## Blockers
- Internos: nenhum.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: gate de secret scan local (gitleaks ausente; download exige autorização) — controle compensatório em todo commit (`git diff --cached --check` + regex de segredos no diff staged); CI/release agora **estrito** (SC-1).
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: code-signing Electron (E-4) — certificados do operador.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY` (previstos): smoke autenticado real de `/v1/messages`/`/v1/responses` (credencial + custo — as chaves coladas não serão usadas); push/PR/publish/deploy (condicional a COMPLETED).

## Gates verificados até aqui (exit code real)
| Gate | Comando | Resultado |
|---|---|---|
| Testes focados por commit | `node --import tsx/esm [--import ./open-sse/utils/setupPolyfill.ts] --test --test-concurrency=1 <arquivos>` / `vitest run --config vitest.config.ts <arquivos>` | PASS em cada commit (falhas listadas acima são pré-existentes e provadas) |
| ESLint (arquivos tocados) | `eslint --max-warnings=0 --suppressions-location config/quality/eslint-suppressions.json --pass-on-unpruned-suppressions <arquivos>` | 0 |
| Prettier (arquivos tocados) | `prettier --write` | aplicado |
| api-typecheck baseline | `_apitc.mjs` | 289 = baseline, 0 regressões |
| tsc core | `tsc -p tsconfig.typecheck-core.json --noEmit` | 0 |
| YAML dos workflows | `_yaml_check.mjs` (parser `yaml`) | 28/28 |
| docs-sync | `node scripts/check/check-docs-sync.mjs` | **PASS** (era FAIL ×41 no HEAD inicial) |
| Dependency scan (prod) | `npm audit --omit=dev --json` | 0 critical · 0 high · **3 moderate** (era 4; restante = cadeia `adm-zip`/onnxruntime, aceita e rastreada) |
| Secret scan local | gitleaks | **NOT_RUN** (binário ausente) |

## Processos / portas
- PID **8488** escuta 20128/20131/20132 = instância de teste do operador (NÃO encerrar).
- Instâncias da missão: nenhuma ativa. Regra: bind 127.0.0.1, porta isolada, `DATA_DIR` temporário, PID registrado, encerrar árvore e confirmar porta livre.

## Riscos
- Escopo amplo → uma fase por vez, um problema por commit, checkpoint a cada progresso.
- `ignoreBuildErrors` esconde erros TS reais → remoção progressiva por pacote (Fase 2).
- Windows: junction do `node_modules` (nunca `npm install` real aqui); CRLF gera falso "drift"; EPERM de `rmSync` com SQLite aberto.

## Próxima ação
1. Commit `docs(audit): checkpoint — Fases 3/5/7/8` (este arquivo + `03` + `04`).
2. Fase 2 higiene: corrigir os teardowns EPERM (fechar DB antes do `rmSync`, `maxRetries`), path separator, `npm.cmd`, `radar-export` (`pathToFileURL`), `check-workflows` (`where`/`which`), revisar os 63 `exclude` do vitest (#8618) — cada um RED→GREEN, sem enfraquecer asserções.
3. R-1 rollback de migração + `audit/ROLLBACK.md`; R-2/R-3/R-5/R-6/R-9/R-12/13/14.

## Instruções de retomada
1. `cd C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port && git status --short --branch && git rev-parse HEAD`
2. Confirmar branch `fix/final-user-readiness` e `origin` = `LMPrado-DZ23/OmniRoute`.
3. Ler este arquivo e `audit/0*.md`; comparar com o estado real; retomar da tarefa pendente mais alta.
4. Nunca `reset --hard`; nunca push sem autorização; nunca usar credenciais coladas no chat; nunca `npm install` sem `--package-lock-only` (junction).
