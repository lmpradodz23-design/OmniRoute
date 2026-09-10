# AUTONOMOUS MISSION STATE — Missão Mestre: OmniRoute pronto para o usuário final

- **mission_id:** omniroute-final-user-readiness-v3.8.51
- **objetivo:** auditar e corrigir integralmente o OmniRoute (seguro, estável, instalável, usável por não-técnicos, compatível com Codex/Claude Code/SDKs OpenAI+Anthropic, observável, recuperável, testado, documentado, empacotado, pronto para release) — **sem publicar nada sem autorização**.
- **repositório canônico:** `LMPrado-DZ23/OmniRoute` (renomeado de `lmpradodz23-design`; mesmo repo, histórico preservado). Upstream só para comparação: `diegosouzapw/OmniRoute`.
- **diretório:** `C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port`
- **branch de trabalho:** `fix/final-user-readiness` (criada de `release/v3.8.51`)
- **HEAD inicial:** `2a156c73812d45119d5a06a2f55d611280442860`
- **HEAD atual:** `2ef9671c4` (28 commits desde o HEAD inicial — ver `git log --oneline 2a156c738..HEAD`)
- **estado:** EXECUTING — **Fase 1 (Segurança P0) CONCLUÍDA**; iniciando ordem 8 do plano (`05-EXECUTION-PLAN.md` §1): Fase 5 onboarding (U1…) → Fase 8 identidade do fork → Fase 7 supply chain → Fase 3 plugins → Fase 2 → Fase 4 → Fase 5 restante → Fase 6 → Fase 9 → CANDIDATE_COMPLETED
- **iteração:** 6
- **início:** 2026-09-09
- **último_heartbeat:** 2026-09-10 — M-2 commitado (`2ef9671c4`), docs `03` atualizados, checkpoint reescrito
- **último_progresso_real:** 2026-09-10 — #2 matriz authz (`ee822b5d6`), E-10 HTTPS remoto (`a639938bf`), M-2 auditoria de grants privilegiados (`2ef9671c4`)
- **toolchain:** node v24.16.0 · npm 11.13.0

## Autorizações (desta missão)
- PODE: auditar; branch de correção; modificar código/testes/docs/migrations/workflows/scripts; instalar deps do lockfile; lint/typecheck/testes/build/pack local; commits locais pequenos; subagentes.
- NÃO PODE sem nova confirmação: push; abrir/mesclar PR; publicar npm/Docker/Electron/Release; deploy; apagar dados reais; force push; reescrever histórico; credenciais reais; custos externos; reduzir segurança; enfraquecer testes.
- **Autorização adicional do operador (2026-09-09, mid-missão):** "quando finalizar a auditoria e as correções, está autorizado a subir e atualizar o GitHub com o projeto corrigido, deixar open source, com imagem e tudo atualizado". Escopo interpretado: **condicional à conclusão** (COMPLETED após as 3 auditorias) → push da branch + PR/merge em `origin` = `LMPrado-DZ23/OmniRoute`; repo público com licença; README/identidade atualizados; imagem de contêiner via **GHCR com `GITHUB_TOKEN`** (Docker Hub exigiria token do operador — não digitar credenciais). **Fora do escopo:** deploy VPS/produção, npm publish, credenciais reais. Até COMPLETED: continua **sem push**.
- Chaves de API coladas pelo operador no chat: **recusadas, nunca usadas**; recomendação de rotação registrada.

## Fase 1 — concluída (todos red-first, um problema por commit)
| Bloco | Itens | Commits |
|---|---|---|
| §4 SSRF | S-2, S-1, (A) withholdPrivateBody, S-4, S-3, guardedFetch, S-5 ×3, **S-7 (bug real do lookup pinado)**, S-6 ×7, trava estrutural | `33b7f20ee` `4d1d5bff3` `6afbb8692` `4a151fb94` `e690a5bfa` `d4efe67c4` `81e8da215` `9012ea229` `a085e638b` `3b1cf11ba` `71cc9b5d1` `9138b87ea` `da3d0892e` `b3c604c97` … `783dfd09a` `6fe72b4b8` `2f5a80e04` |
| §7 MCP | M-1, R-10, M-2 | `0e594e7a6` `482511918` `2ef9671c4` |
| §1 Electron | E-1, E-2, E-3, E-7, E-10 (HTTPS remoto) | `f90d3e2d0` `a639938bf` |
| §3 OpenAPI Try | #5 residual | `7cdf5a0a8` |
| §5 API keys | #7 reveal-once (Opção A avaliada, não adotada — motivo em `03`) | `f9ec8e0ed` |
| §6 Criptografia/readiness | #3 perfil exposto + `storage` readiness (JWT/API_KEY_SECRET em repouso = N/A) | `87c4478a5` |
| §2 LOCAL_ONLY | #2 matriz 144 células | `ee822b5d6` |

Status detalhado por achado: `audit/03-SECURITY-FINDINGS.md` (tabelas "Status após a execução").

## Tarefa atual
Ordem 8 do plano — **Fase 5 onboarding**: U1 (`onboarding/page.tsx:84` `errorMessage` nunca renderizado), U2, U3, U4, U8 conforme `audit/04-PRODUCT-GAPS.md`. Loop: provar (teste RED) → corrigir → regressão → lint/prettier → secret sweep → commit → checkpoint.

## Tarefas pendentes (ordem do plano)
- [ ] 8 · Fase 5 onboarding: U1, U2, U3, U4, U8.
- [ ] 9 · Fase 8 identidade do fork: E-9 (`electron/package.json` publish), J15 (`versionCheck.ts`), mapa `diegosouzapw` em `04` (corrigir vs manter deliberado).
- [ ] 10 · Fase 7 supply chain: SC-1 (scanner ausente falha o gate), SC-4, SC-5 (workflow; sem deploy), SC-2/6, SC-7, SC-8; `uses:` por tag → SHA.
- [ ] 11 · Fase 3 plugins: P-1 checksum obrigatório, P-2/P-3 disclosure, P-4 extração segura ou desabilitar, P-7, P-6, P-8.
- [ ] 12 · Fase 2 confiabilidade/DB: R-1 rollback (+ `ROLLBACK.md`), R-2, R-3, R-4, R-5, R-6, R-9, R-12, R-13, R-14; higiene de testes (lista abaixo).
- [ ] 13 · Fase 2 tipagem: R-20 progressivo.
- [ ] 14 · Fase 4 guardrails/PII fail-closed; paridade `/v1/chat/completions`, `/v1/messages`, `/v1/responses`.
- [ ] 15 · Fase 5 UX/a11y restante (A1, A2, M1, I1–I3, J2, J13, J17) + docs pt-BR "primeiro uso".
- [ ] 16 · Fase 6 compatibilidade (Codex, Claude Code, SDKs, MCP, SSE, cancelamento, usage) com instância isolada.
- [ ] 17 · Fase 9 matriz de testes + empacotamento → `TEST_MATRIX.md`.
- [ ] 18 · CANDIDATE_COMPLETED → 3 auditorias independentes → `FINAL_THREE_AGENT_REVIEW.md` → fix loop → COMPLETED → (autorização condicional) push/PR/GHCR.
- [ ] Entregáveis: `FINAL_REPORT`, `TEST_MATRIX`, `SECURITY_REMEDIATION`, `USER_JOURNEYS`, `RELEASE_READINESS`, `ROLLBACK`.

## Falhas pré-existentes provadas (via `git stash` no HEAD sem a alteração) — Fase 2 higiene de testes, NÃO tocadas
- `tests/integration/qdrant-routes.test.ts` embedding-models ×3 (rota injeta default + registry curado → 67 modelos; testes esperam 0/só openai).
- `tests/unit/version-manager*.test.ts` "rolls back" — EPERM `symlinkSync` no Windows.
- `tests/unit/proxy-fallback-ssrf.test.ts` — teardown EPERM (DB aberto no `rmSync`).
- `tests/unit/api-key-lifecycle.test.ts`, `tests/unit/api-key-regeneration.test.ts` — EPERM de suite no Windows (`rmSync` do DATA_DIR com handle SQLite); os 13 testes internos passam.
- `tests/unit/electron-resolve-server-entry.test.ts` "only checks for server-ws.mjs inside the given serverDir" — separador de caminho Windows (`\fake\standalone` vs `/fake/standalone`).

## Blockers
- Internos: nenhum.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: **gate de secret scan** — gitleaks ausente; download exige autorização. Controle compensatório em todo commit: `git diff --cached --check` + varredura regex do diff staged (`sk-`, `AKIA`, `ghp_`, `xox*-`, `PRIVATE KEY`, `AIza`, `sk-ant-`). Gate real = `NOT_RUN`.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`: code-signing Electron (E-4) — certificados do operador.
- `BLOCKED_BY_EXTERNAL_DEPENDENCY` (previstos): smoke autenticado real de `/v1/messages`/`/v1/responses` (credencial + custo — as chaves coladas no chat não serão usadas); push/PR/publish/deploy (autorização condicional, só após COMPLETED).

## Gates verificados até aqui (todos com exit code real)
| Gate | Comando | Resultado |
|---|---|---|
| Testes focados por commit | `node --import tsx/esm [--import ./open-sse/utils/setupPolyfill.ts] --test --test-concurrency=1 <arquivos>` | PASS em cada commit (matriz 13/13; electron 208/209 com 1 pré-existente; MCP/api-keys 76/76) |
| ESLint nos arquivos tocados | `node ./node_modules/eslint/bin/eslint.js --max-warnings=0 <arquivos>` | 0 (nits pré-existentes expostos por deslocamento de linha corrigidos no próprio arquivo) |
| Prettier nos arquivos tocados | `node ./node_modules/prettier/bin/prettier.cjs --write` | aplicado |
| api-typecheck baseline | `_apitc.mjs` (tsc direto; `npx.cmd` EINVAL no host) | 289 = baseline, 0 regressões |
| tsc core | `tsc -p tsconfig.typecheck-core.json --noEmit` | 0 |
| Dependency scan (prod) | `npm audit --omit=dev --json` | 0 critical · 0 high · 4 moderate |
| Secret scan | gitleaks | **NOT_RUN** (SC-1) |

## Processos / portas
- PID **8488** escuta 20128/20131/20132 = **instância de teste do operador** (NÃO encerrar).
- Instâncias de teste da missão: nenhuma ativa. Regra: bind 127.0.0.1, porta isolada, `DATA_DIR` temporário, PID registrado, encerrar árvore e confirmar porta livre ao fim.

## Riscos
- Escopo amplo → controlar por fase, um problema por commit, checkpoint após cada progresso.
- `ignoreBuildErrors` esconde erros TS reais → remoção progressiva por pacote (Fase 2).
- Windows: junction do `node_modules` quebra Turbopack (`OMNIROUTE_USE_TURBOPACK=0`); CRLF gera falso "drift" (git diff é a verdade); EPERM de `rmSync` com SQLite aberto em vários teardowns (Fase 2).

## Próxima ação
1. Commit `docs(audit): Fase 1 concluída` (este checkpoint + `03`).
2. Fase 5 U1: ler `src/app/(dashboard)/onboarding/page.tsx` (ou caminho real), teste RED provando que `errorMessage` não é renderizado, corrigir, regressão, commit.
3. Seguir a ordem 9 → 17; checkpoint a cada commit.

## Instruções de retomada
1. `cd C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port && git status --short --branch && git rev-parse HEAD`
2. Confirmar branch `fix/final-user-readiness` e `origin` = `LMPrado-DZ23/OmniRoute`.
3. Ler este arquivo e `audit/0*.md`; comparar com o estado real; retomar da tarefa pendente mais alta.
4. Nunca `reset --hard`; nunca push sem autorização; nunca usar credenciais coladas no chat.
