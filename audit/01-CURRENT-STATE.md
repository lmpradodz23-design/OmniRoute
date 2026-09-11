# 01 — Estado atual do repositório (Fase 0)

Data: 2026-09-09 · Missão: `omniroute-final-user-readiness-v3.8.51`

## Identidade do checkout (verificada)

| Item                 | Valor                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Diretório            | `C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port`                     |
| Repositório canônico | `https://github.com/LMPrado-DZ23/OmniRoute` (renomeado de `lmpradodz23-design`; mesmo repo) |
| `origin`             | `LMPrado-DZ23/OmniRoute` (corrigido nesta missão por rename não-destrutivo)                 |
| `upstream`           | `diegosouzapw/OmniRoute` (só para comparação; sem permissão de push)                        |
| Branch de trabalho   | `fix/final-user-readiness` (criada de `release/v3.8.51`)                                    |
| HEAD inicial         | `2a156c73812d45119d5a06a2f55d611280442860`                                                  |
| Working tree         | limpo (`git status --short` vazio) no início da missão                                      |
| Node / npm           | v24.16.0 / 11.13.0                                                                          |
| Produto              | `omniroute` **3.8.51** (`package.json`)                                                     |

O SHA `b345c7f6cd4e…` é a base da auditoria anterior; **não** é o HEAD atual e não foi forçado.

## Inventário

| Métrica                                   | Valor                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations SQL (`src/lib/db/migrations`)  | 170                                                                                                                                                        |
| Rotas API (`src/app/api/**/route.ts`)     | 697                                                                                                                                                        |
| Arquivos de teste unitário (`tests/unit`) | 4335                                                                                                                                                       |
| Scripts npm                               | 190                                                                                                                                                        |
| Workflows GitHub Actions                  | 26                                                                                                                                                         |
| `next.config.mjs`                         | `ignoreBuildErrors: true` (L383) — erros TS não bloqueiam o build                                                                                          |
| Electron                                  | `electron/` (main.js, preload.js, loginManager.js, processTree.js, lib/ipcOriginGuard.js, …)                                                               |
| Docker                                    | `Dockerfile`, `Dockerfile.bun`, `docker-compose.yml`, `docker-compose.prod.yml`                                                                            |
| Top-level                                 | `@omniroute/ audit/ bin/ changelog.d/ config/ contrib/ docker/ docs/ electron/ examples/ images/ open-sse/ packages/ public/ scripts/ skills/ src/ tests/` |

## O que já está integrado em `release/v3.8.51` (missão anterior, COMPLETED)

- Os **8 findings** do scan de segurança remediados com teste de regressão cada (PR #3): SSRF do teste de webhook, LOCAL_ONLY loopback-only, `encryptOrThrow` fail-closed, MCP scopes default-ON, OpenAPI Try, Electron IPC, API keys hash-only + cifra em repouso, webhook secret cifrado.
- **Base hygiene** (PR #4): `glm.ts` TS2554, contagem de migrations nos docs, changelog + skills gerados, e o fix do sanitizador de paths (`12cacb538`).
- **UX**: botão "Configurar" dos Agentes de Nuvem (`?section=` → `?cat=cloudagent`, `2a156c738`).
- Validação integrada já registrada: suíte de segurança 64/64; open-sse typecheck 0 erros; api-typecheck 0 regressões vs baseline; docs-counts / changelog / env-doc OK; build de produção (webpack) OK; boot isolado OK.

Estes itens serão **revalidados** nesta missão (Fase 1), não presumidos.

## Estado do CI na branch `release/v3.8.51`

- Único vermelho: `Build Docker (amd64/arm64)` — `##[error]Username and password required` (login Docker Hub). Causa: a fork não tem os secrets `DOCKERHUB_*` e o alvo é a imagem do upstream `diegosouzapw/omniroute`. É etapa de **publish** (Fase 8 corrige a identidade; publicação continua proibida sem autorização).
- PR #2 (`superpowers-on-v3.8.51`) estava vermelha por estar 20+ commits atrás; merge da release + bump de migrations (171 naquela branch) foi aplicado e enviado antes desta missão. Está **fora do escopo** desta missão (é um subsistema grande; a missão manda estabilizar o produto atual primeiro).

## Processos e portas no host (no início da missão)

- PID **8488** escuta `0.0.0.0:20128`, `127.0.0.1:20131`, `127.0.0.1:20132` → **instância de teste do operador** (iniciada por ele em `DATA_DIR=C:/Users/zodyp/omniroute-novo-teste`, dashboard 21288 + API Bridge 20128). Não é órfão da missão; **não encerrar**.
- Instâncias da missão: nenhuma. Qualquer teste de servidor usará bind `127.0.0.1`, porta isolada, `DATA_DIR` temporário, PID registrado e encerramento da árvore.

## Peculiaridades de ambiente (afetam como testar, não o produto)

| Sintoma                                                                             | Causa                                                         | Como lidar                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Turbopack: `Symlink [project]/node_modules is invalid`                              | `node_modules` é junction para `../OmniRoute/node_modules`    | `OMNIROUTE_USE_TURBOPACK=0` (webpack) — build passa                          |
| `generate-agent-skills.mjs` dry-run reporta `Generated: 1` (cli-tunnel) e sai com 2 | CRLF no working tree Windows vs LF gerado                     | `git diff --stat` vazio ⇒ falso drift; CI Linux verde                        |
| `npx.cmd` → `spawnSync EINVAL`                                                      | shim quebrado neste host                                      | invocar `node ./node_modules/<pkg>/bin/...`                                  |
| Servidor sobe na 20128 mesmo com `OMNIROUTE_PORT`                                   | porta é `DASHBOARD_PORT`/`PORT`; API Bridge sempre pede 20128 | usar `DASHBOARD_PORT` e garantir 20128 livre, ou aceitar bridge desabilitado |
| EPERM em teardown de alguns testes                                                  | Windows file locking                                          | passam em Linux CI; `--test-concurrency=1` reduz                             |

## Autorizações desta missão

Permitido: auditar, branch de correção, editar código/testes/docs/migrations/workflows/scripts, deps do lockfile, lint/typecheck/testes/build/pack locais, commits locais, subagentes.
**Proibido sem nova confirmação:** push, abrir/mesclar PR, publicar (npm/Docker/Electron/Release), deploy, apagar dados reais, force push, reescrever histórico, credenciais reais, custos externos, reduzir segurança, enfraquecer testes.

## Referências da auditoria anterior

- Relatório: `C:\Users\zodyp\.codex\security-scans\OmniRoute-release-v3.8.51\unversioned_20260908T234305Z_f51y_o7t\report.md` (8 findings: 7 high, 1 medium; superfícies "needs follow-up": plugins/marketplace, guardrails, CI supply chain, container/browser sidecar).
- SARIF: `…\exports\results.sarif`. Snapshot ZIP sem `.git` — não representa o HEAD atual.

## Próximos documentos da Fase 0

`02-ARCHITECTURE.md`, `03-SECURITY-FINDINGS.md`, `04-PRODUCT-GAPS.md`, `05-EXECUTION-PLAN.md` — consolidados a partir de 4 auditorias read-only independentes (arquitetura, segurança, produto/UX, qualidade).
