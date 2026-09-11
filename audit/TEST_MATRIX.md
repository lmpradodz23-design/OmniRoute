# TEST_MATRIX — Fase 9 (gates executados com exit code real)

- **Branch:** `fix/final-user-readiness` · **HEAD da matriz:** (preenchido ao fechar) · **Data:** 2026-09-11
- **Ambiente:** Windows 11 Pro 10.0.26200 · node v24.16.0 · npm 11.13.0 · `node_modules` = junction para o checkout irmão (Turbopack recusa → dev/E2E com `OMNIROUTE_USE_TURBOPACK=0`)
- **Regra:** cada linha registra o comando exato e o exit code observado. `NOT_RUN` nunca vira `PASS`. `BLOQUEADO POR AMBIENTE` = falha reproduzida sem as mudanças da missão (stash) e atribuída ao ambiente Windows/toolchain.
- **Logs brutos:** scratchpad da sessão (`_gate_*.log`, `_unit_ci.log`, `_integration.log`, …); resumos abaixo.

## 1. Gates rápidos (lint / tipos / formato)

| Gate                      | Comando                                                                                             | Exit | Resultado | Observação                               |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ---- | --------- | ---------------------------------------- |
| lint                      | `eslint . --cache --suppressions-location config/quality/eslint-suppressions.json --max-warnings 0` | —    | PENDENTE  |                                          |
| typecheck:core            | `tsc -p tsconfig.typecheck-core.json`                                                               | —    | PENDENTE  |                                          |
| typecheck:noimplicit:core | `tsc -p tsconfig.typecheck-noimplicit-core.json`                                                    | —    | PENDENTE  |                                          |
| typecheck open-sse (+bin) | `tsc -p open-sse/tsconfig.json --noEmit`                                                            | —    | PENDENTE  |                                          |
| api-typecheck baseline    | `scratchpad/_apitc.mjs` (parser de `scripts/check/check-api-typecheck.mjs`)                         | 0    | PASS      | 289 = baseline, 0 regressões (após R-21) |
| format:check              | `prettier --check .`                                                                                | —    | PENDENTE  |                                          |

## 2. Gates `check:*` do CI (`quality.yml`, non-fail-fast)

| Gate                       | Exit | Resultado | Observação |
| -------------------------- | ---- | --------- | ---------- |
| (preenchido pela execução) |      |           |            |

## 3. Suítes de teste

| Suíte                         | Comando                                    | Exit | Resultado | Observação      |
| ----------------------------- | ------------------------------------------ | ---- | --------- | --------------- |
| unit (node:test, CI)          | `npm run test:unit:ci`                     | —    | PENDENTE  |                 |
| UI (vitest jsdom)             | `vitest run --config vitest.config.ts`     | —    | PENDENTE  |                 |
| MCP (vitest node)             | `vitest run --config vitest.mcp.config.ts` | —    | PENDENTE  |                 |
| integration                   | `npm run test:integration`                 | —    | PENDENTE  |                 |
| security (fase01)             | `npm run test:security`                    | —    | PENDENTE  |                 |
| compat isolado (Fase 6)       | `npm run test:compat`                      | 0    | PASS      | 8/8 (a09c69198) |
| system failover (E2E isolado) | `npm run test:system`                      | —    | PENDENTE  |                 |

## 4. Build / empacotamento / instalação

| Etapa                     | Comando                                                   | Exit | Resultado | Observação |
| ------------------------- | --------------------------------------------------------- | ---- | --------- | ---------- |
| build (Next isolado)      | `npm run build`                                           | —    | PENDENTE  |            |
| pack artifact             | `npm run check:pack-artifact`                             | —    | PENDENTE  |            |
| pack boot                 | `npm run check:pack-boot`                                 | —    | PENDENTE  |            |
| install-upgrade smoke     | `npm run check:install-upgrade`                           | —    | PENDENTE  |            |
| Electron (unit + package) | suites `electron-*` (137) + `electron/package.json` files | —    | PENDENTE  |            |

## 5. Segurança / dependências

| Gate                   | Comando                       | Exit | Resultado | Observação                                                                         |
| ---------------------- | ----------------------------- | ---- | --------- | ---------------------------------------------------------------------------------- |
| dependency scan (prod) | `npm audit --omit=dev --json` | —    | PENDENTE  |                                                                                    |
| secret scan (gitleaks) | —                             | —    | NOT_RUN   | binário ausente; controle compensatório: sweep regex do diff staged em todo commit |
| semgrep                | —                             | —    | NOT_RUN   | binário ausente                                                                    |

## 6. Artefatos (SHA-256)

| Artefato                     | SHA-256 | Tamanho |
| ---------------------------- | ------- | ------- |
| (preenchido após build/pack) |         |         |
