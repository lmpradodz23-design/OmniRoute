# COMPATIBILITY MATRIX — OmniRoute Unified (Fase 0)

- **Data:** 2026-09-06 · **Host:** Windows 11 Pro 10.0.26200 (win32)
- **Máquina de auditoria:** node v24.16.0, npm 11.13.0, docker 29.7.2 + compose v5.5.0,
  uv 0.12.5, python 3.14.5, bun 1.4.0 (isolado em `~/.bun`; shim npm quebrado).

## 1. Runtimes exigidos × disponíveis

| Componente                 | Runtime exigido                                         | Disponível na máquina                                      | Veredito                        |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| OmniRoute                  | Node `>=22.22.2 <23                                     |                                                            | >=24.0.0 <27` (`.nvmrc`=24)     | Node 24.16.0 | ✅ compatível |
| OmniRoute (build nativo)   | toolchain C++ (MSVC "Desktop C++") + Python p/ node-gyp | **ausente** (node-gyp: "Could not find any Visual Studio") | ❌ **bloqueado** (ver evid. 14) |
| codex-chatgpt-web          | Bun `1.4.0` (pin em engines)                            | Bun 1.4.0 (isolado)                                        | ✅ compatível                   |
| codex-chatgpt-web/launcher | Bun + Electron 41.10.7                                  | Bun 1.4.0; Electron via install                            | ⏳ (job launcher)               |
| Presidio                   | Docker; ou pip + Python 3.9–3.12 (spaCy)                | Docker ✅; Python 3.14 ❌ p/ pip                           | usar **Docker** ou uv-3.12      |
| MarkItDown                 | pip `markitdown` Python `>=3.10` (classifiers ≤3.13)    | Python 3.14 ❌                                             | **uv-3.12**                     |
| Browser Use                | pip `browser-use` Python `>=3.11,<4.0`                  | Python 3.14 ❌                                             | **uv-3.12**                     |
| Qdrant                     | Docker (Apache-2.0)                                     | Docker ✅                                                  | ✅ imagem                       |
| OTel Collector Contrib     | Docker                                                  | Docker ✅                                                  | ✅ imagem                       |
| AG-UI                      | npm (JS)                                                | Node ✅                                                    | ✅ lib                          |
| MCP Registry               | API HTTP versionada (read-only)                         | rede ✅                                                    | ✅ API                          |

## 2. Superfícies de API (requisito do produto)

| Endpoint                    | Padrão                  | Estado no OmniRoute (SHA f9a1cc8)                                                                           |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/v1/messages`              | Anthropic (Claude Code) | ✅ **já existe** (`src/app/api/v1/messages/route.ts`; cita "Claude Code"; guard de injeção, keepalive/ping) |
| `/v1/messages/count_tokens` | Anthropic               | ✅ existe                                                                                                   |
| `/v1/responses`             | OpenAI Responses        | ✅ existe (`src/app/api/v1/responses`)                                                                      |
| `/v1/chat/completions`      | OpenAI                  | ✅ existe                                                                                                   |
| Porta padrão                | —                       | 20128 (bate com o plano)                                                                                    |

**Conclusão:** o requisito adicional (Claude Code via `/v1/messages`) já é **nativo**.

## 3. Componentes: forma de consumo e versão a fixar

| Componente             | Consumo                            | Versão/tag a fixar                                                                | Licença                       |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Presidio               | 2 serviços Docker                  | `mcr.microsoft.com/presidio-analyzer:2.2.362`, `-anonymizer:2.2.362` (multi-arch) | MIT                           |
| MCP Registry           | API read-only (self-host opcional) | commit `739b70e8`; API schema `2025-12-11`                                        | Apache-2.0 híbrido (evid. 13) |
| MarkItDown             | worker Python (uv-3.12)            | `markitdown==0.1.7`                                                               | MIT                           |
| Qdrant                 | serviço Docker                     | **`qdrant/qdrant:v1.19.1`** (com "v"; multi-arch ~74MB)                           | Apache-2.0                    |
| OTel Collector Contrib | serviço Docker                     | `otel/opentelemetry-collector-contrib:0.160.0` (~94MB)                            | Apache-2.0                    |
| AG-UI                  | lib npm                            | `@ag-ui/core                                                                      | client                        | encoder@0.0.59` (pré-1.0, travar) | MIT |
| Browser Use            | worker Python (uv-3.12)            | `browser-use==0.13.10` (61 deps; Chromium à parte)                                | MIT · **alto impacto**        |

## 4. Incompatibilidades e conflitos de ambiente (reproduzidos)

| #   | Incompatibilidade                                                                                            | Evidência         | Mitigação                              |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------- |
| C1  | npm global `dev=false` → devDeps omitidas                                                                    | verify2/3 logs    | `npm install --include=dev`            |
| C2  | npm 11 pula install-scripts de optionalDependencies (sai 0)                                                  | check-native-deps | `--foreground-scripts`/approve-scripts |
| C3  | Sem MSVC C++ → nativos não compilam (better-sqlite3, sqlite-vec, keytar, wreq-js, @huggingface/transformers) | evid. 14 (gyp)    | VS Build Tools **ou** perfil Docker    |
| C4  | EBUSY/EPERM (Defender/locks) em `npm ci` cleanup (onnxruntime-node, @swc, esbuild)                           | verify2/3 logs    | `npm install` in-place / Docker Linux  |
| C5  | Pacote npm `bun` `install.js` falha (shim bun quebrado)                                                      | verify3 log       | `--ignore-scripts` ou reparar shim     |
| C6  | `--omit=optional` quebra dep `bun` (@oven/bun-windows-x64)                                                   | verify2 log       | não omitir optional                    |
| C7  | Python 3.14 sem wheels p/ Presidio/MarkItDown/Browser-Use                                                    | evid. 12          | uv-pin 3.12                            |
| C8  | Bun shim do npm quebrado (aponta p/ bun.exe inexistente)                                                     | evid. 00/11       | usar `~/.bun/bin/bun.exe`              |

## 5. Delta de versão do provedor ChatGPT Web

| Item                       | Valor                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Vendor dentro do OmniRoute | codex-chatgpt-web **v4.0.7** (commit `b59d7dc5`), atribuído em THIRD_PARTY_NOTICES    |
| Base congelada pelo plano  | codex-chatgpt-web **v5.0.4** (commit `c648c09`)                                       |
| Ação                       | adotar v5.0.4 exige re-auditoria do delta (§2 do plano) → decisão de escopo (ADR-001) |

## 6. Resultados de baseline (execução real)

| Projeto                        | Instalação                                                                        | Typecheck      | Lint                                      | Testes                                                                              | Build                          | Smoke                                          |
| ------------------------------ | --------------------------------------------------------------------------------- | -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| **codex-chatgpt-web** (core)   | ✅ `bun install --frozen-lockfile` EXIT 0                                         | ✅ limpo       | —                                         | ✅ **651 pass / 4 fail** (falhas = `electron` do launcher ausente)                  | —                              | smoke:codex = AUTH_REQUIRED (Fase 2)           |
| **codex-chatgpt-web/launcher** | ✅ `bun install` EXIT 0 (Electron 41.10.7)                                        | ✅ EXIT 0      | —                                         | ✅ **281 pass / 0 fail**                                                            | ✅ `vite build` EXIT 0 (26,5s) | —                                              |
| **OmniRoute**                  | ✅ 2 etapas (`--ignore-scripts` + `npm rebuild`), 2518 pkgs; nativos ✅ (VS 2022) | — (sem script) | ✅ **sem violação** (exit 2 = supressões) | ⚠️ **parcial**: centenas passam; suíte completa >60min; ~35 auth-policy env/fixture | ✅ **EXIT 0** (Next/Turbopack) | ✅ **EXIT 0** (health/rotas; sem geração real) |

> Launcher: `bun run build` falha só pelo shim do Bun (C8); `vite build` direto OK.
> **OmniRoute (pós-Opção A):** VS Build Tools instalado, install limpo único, nativos
> compilados, `check-native-deps` OK, `better-sqlite3` executa. Build+smoke ✅; lint sem
> violação; testes com ressalva (evid. 17). C3/C4/C9 **resolvidos**.

**C9** (resolvido): era `node_modules` invalidado por concorrência — sanado com **uma única**
instalação limpa (VS Build Tools presente). **C3** (toolchain) e **C5/C6** (bun) contornados
via 2 etapas `--ignore-scripts` + `npm rebuild`.
