# BASELINE AUDIT — OmniRoute Unified (Fase 0)

- **Data:** 2026-09-06 · **Host:** Windows 11 Pro 10.0.26200 (win32)
- **Workspace isolado:** `C:\Users\zodyp\Downloads\OmniRoute-Unified` (nada tocado em
  `~/.omniroute`, `~/.codex`, `~/.codex-chatgpt-web`, `Documents/Codex/*`, `AppData/Roaming/Hermes*`)
- **Evidências brutas:** `docs/evidence/` (logs com comando + saída real + exit codes)

## 1. Objetivo e limite da Fase 0

Auditar e estabelecer baseline dos 2 projetos-base + 7 componentes, **sem alteração
funcional**, e decidir GO/NO-GO para a Fase 1. Nenhuma linha de código de produto foi
escrita; apenas clones, instalação de dependências e execução de verificações.

## 2. Ambiente

| Ferramenta           | Versão                    | Nota                                                                         |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| Node                 | v24.16.0                  | compatível com OmniRoute (`.nvmrc`=24; engines `>=24 <27`)                   |
| npm                  | 11.13.0                   | config global **`dev=false`** (omitia devDeps) + npm11 pula optional-scripts |
| Docker + Compose     | 29.7.2 / v5.5.0           | ok                                                                           |
| uv                   | 0.12.5                    | usar p/ pin Python 3.12                                                      |
| Python               | 3.14.5                    | novo demais p/ Presidio/MarkItDown/Browser-Use                               |
| Bun                  | 1.4.0 (`~/.bun`)          | shim do npm quebrado; binário isolado funciona                               |
| Toolchain C++ (MSVC) | **ausente**               | bloqueia build nativo do OmniRoute                                           |
| Disco C:             | ~60 GB livres (foi 35→64) | apertado; economia aplicada                                                  |

## 3. Fontes congeladas (9/9 verificadas — HTTP 200 + metadados)

Ver `docs/evidence/01-sha-verification.md` e `THIRD_PARTY_NOTICES.md`. Todos os SHAs
existem. Base: OmniRoute `f9a1cc8` (v3.8.51, MIT), codex-chatgpt-web `c648c09` (v5.0.4, MIT).
Componentes: Presidio/MarkItDown/AG-UI/Browser-Use (MIT), Qdrant/OTel (Apache-2.0),
MCP Registry (Apache-2.0 híbrido — auditado manualmente, evid. 13).

## 4. Inventário do OmniRoute (SHA f9a1cc8, v3.8.51)

- **Tipo:** gateway de IA OpenAI-compatible, produto maduro; framework **Next.js**;
  CLI (`bin/omniroute.mjs`) + app **Electron** (`electron/main.js`, `loginManager.js`).
- **Persistência:** **SQLite** (`better-sqlite3`, com fallback); `DATA_DIR` configurável
  (`src/lib/dataPaths.ts`). Não usa Postgres no core.
- **APIs (Next app router `src/app/api/v1/`):** `messages` (Anthropic), `responses`
  (OpenAI), `chat/completions`, `completions`, `embeddings`, `models`, `mcp`, etc.
- **Porta padrão:** 20128 (env `PORT`/`OMNIROUTE_PORT`).
- **Integração ChatGPT Web JÁ PRESENTE:** `open-sse/vendor/codex-chatgpt-web/` (v4.0.7),
  providers `chatgpt-web`/`chatgpt-web-codex`/`codex`, executores com doctor/runtime/
  storageState/tunnelClient, bridge `internal/codex-responses-ws`, auth `oauth/codex`,
  ~36 testes. (evid. 02)
- **docker-compose** já orquestra: `qdrant`, `redis`, `chatgpt-web-codex-browser`,
  `codex-app-server`, `omniroute-{base,web,cli,host}`, `bifrost`, `cliproxyapi`.
- **CI/CD:** `.github/` (workflows electron/docker/unit), husky, gitleaks, trivy, vale.
- **Testes:** suíte grande (`node --test` + tsx), muitos diretórios (`tests/unit/{api,...}`).

## 5. Inventário do codex-chatgpt-web (SHA c648c09, v5.0.4)

- **Runtime:** TypeScript + **Bun 1.4.0** (pin). Estrutura: `src/`, `launcher/` (Electron
  41.10.7, Vite), `tests/`, `docs/`, `LICENSES/`.
- **Arquitetura:** bridge Responses local que roteia tarefas do Codex por sessão ChatGPT
  Web autenticada. **Loopback 127.0.0.1 hard-validado** (`config.ts` faz throw se ≠),
  **porta 17841**, health `GET /healthz`, admin (`/admin/drain|resume|cancel-turn|shutdown`)
  com **bearer token aleatório**; modo full usa **token por turno** + túnel HTTPS de saída
  (sem listener público) + MCP stdio. Segredos nunca no contexto do modelo. (evid. 11)

## 6. Resultados de baseline (execução real)

### 6.1 codex-chatgpt-web (core) — evid. 11

- `bun install --frozen-lockfile` **EXIT 0** (108 pkgs) · typecheck **limpo** (`bun x tsc --noEmit`).
- Testes: **651 pass / 4 fail** (as 4 falhas = `Cannot find package 'electron'`, do
  workspace `launcher/` não instalado; nenhuma é defeito de lógica).
- smoke:codex / live → **AUTH_REQUIRED** (exige login humano no ChatGPT) → **Fase 2**.
- **Veredito: PASS isolado (sem login).**

### 6.2 codex-chatgpt-web/launcher (Electron) — evid. _launcher-verify

- `bun install --frozen-lockfile` **EXIT 0** (Electron 41.10.7 presente).
- typecheck **EXIT 0** · testes **281 pass / 0 fail** · **build (renderer) EXIT 0**
  (`vite build`, 26,5s, gera `dist/`).
- Nota: `bun run build` (wrapper encadeado) falha só pelo **bug de shim do Bun no Windows**;
  invocação direta do `vite build` funciona. As 4 falhas de 6.1 são cobertas aqui.
- **Veredito: PASS.**

### 6.3 OmniRoute — evid. 14/15/17 + logs `_omni-*`

**Remediação Opção A aplicada e verificada:** VS Build Tools 2022 (VC 14.44) instalado;
**uma única** instalação limpa em 2 etapas — `npm ci --include=dev --include=optional
--ignore-scripts` (2518 pkgs, EXIT 0) + `npm rebuild` dos nativos (com bun no PATH só do
comando; sem alterar npm config global). `check-native-deps` → **OK (31 pacotes)**;
`better-sqlite3` **carrega e executa** (prebuild win32-x64). devbin completo (eslint/tsx/
next/cross-env).

Resultados reais (evid. 17):

- **BUILD `npm run build` → EXIT 0 ✅** (Next/Turbopack ~32 min; copia binários nativos).
- **SMOKE → EXIT 0 ✅** (escopo limitado): server sobe, health 200, `/v1/models` 401,
  `OPTIONS /v1/messages|/v1/responses` 204, `POST` sem key → 400 tipado. **Não** comprova
  geração/roteamento real (exige chamada autenticada com provider). Órfão do 1º cleanup
  corrigido; próximo smoke: bind 127.0.0.1 + kill de árvore no trap.
- **LINT `npm run lint` → EXIT 2**, porém **sem violação de código** — é apenas supressões
  obsoletas ("--prune-suppressions"); com `--pass-on-unpruned-suppressions` = 0.
- **TESTES:** suíte **completa** não termina em 60 min (volume + tsx; não é trava de setup).
  Subconjunto real: **centenas passam**; falhas se dividem em (a) artefato de runner
  `runtimeRequire.ts:13` `createRequire(process.argv[1])` com glob relativo sob `node --test`
  no Windows (some com caminho absoluto), e (b) ~35 testes de **auth-policy dependentes de
  env/fixture** do harness (ex.: peer-stamp espera `stamp-tok`, recebe UUID). **Nenhuma é
  regressão** (commit congelado; zero código de produto alterado).
- **Veredito: PASS com ressalva de testes.** Build/instalação/nativos/smoke OK; a suíte
  completa deve ser rodada no **harness oficial (CI/Docker)** para o verde canônico. Os 3
  bloqueios do NO-GO anterior (VS ausente, nativos não compilados, node_modules concorrente)
  estão **resolvidos**.

## 7. Componentes adicionais (forma de consumo) — evid. 12

Resumido no `COMPATIBILITY_MATRIX.md §3`. Destaques: Qdrant `v1.19.1`, Presidio Docker
`2.2.362`, OTel `0.160.0`, MarkItDown `0.1.7`, Browser-Use `0.13.10` (alto impacto),
AG-UI `@ag-ui/*@0.0.59`, MCP Registry API `2025-12-11` (licença Apache-2.0 híbrida).
Python 3.12 via uv para os workers Python.

## 8. Delta do provedor ChatGPT Web (obrigatório registrar)

- OmniRoute vendoriza **v4.0.7** (commit `b59d7dc5`); base congelada = **v5.0.4** (`c648c09`).
- Diferença de 3 minor/patch. Adotar v5.0.4 no vendor exige **re-auditoria do delta**
  (diff, testes, comparação de segurança) — §2 do plano. **Decisão de escopo** (ADR-001).

## 9. Riscos principais

- Ambiente Windows hostil a build nativo (C++/EBUSY/bun-shim) → padronizar **Docker** para
  runtime do OmniRoute nas próximas fases.
- Disco C: apertado → manter economia; considerar mover workspace/volumes.
- Fase 2+ exige **login humano no ChatGPT** (AUTH_REQUIRED).
- Delta de versão do vendor não resolvido (decisão de escopo).

## 10. Conclusão

Objetivo de auditoria da Fase 0 (mapear contratos, forma de consumo e incompatibilidades)
**cumprido** com evidências reais. Descoberta central: **grande parte das Fases 1–3 já
existe no OmniRoute upstream** (vendor + provider + `/v1/messages`/`/v1/responses`).

Após a **Opção A** (VS Build Tools + instalação limpa única), o **baseline do OmniRoute é
PASS com ressalva de testes** (§6.3): build EXIT 0, smoke EXIT 0, lint sem violações,
nativos OK; a suíte de testes completa não termina em 60 min neste ambiente e tem falhas
env/fixture-dependentes em auth-policy (não-regressão). O baseline do **codex-chatgpt-web
(core + launcher) é PASS** (§6.1/6.2).

**Recomendação de gate: GO condicional** — condições: (1) rodar a suíte completa de testes
no harness oficial (CI/Docker) para o verde canônico; (2) manter vendor codex-chatgpt-web
v4.0.7 nesta fase (delta v5.0.4 é fase isolada pós-GO). Gate final em
`docs/evidence/GATE.md`. **A Fase 1 não inicia sem a autorização do aprovador.**
