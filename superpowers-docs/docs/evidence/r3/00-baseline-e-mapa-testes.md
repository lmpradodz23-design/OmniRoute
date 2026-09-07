# R3 — Baseline da worktree c0b2253 + mapa de testes removidos

> Worktree isolada `repos/OmniRoute-r3-c0b2253` (branch `r3-backport-base`). Gate NO-GO;
> Fase 1 bloqueada. Backport autorizado para implementação controlada (ADR-002).

## 1. Baseline (item 5)

- **SHA:** `c0b2253f21c2e70c5d73581ae1be6f60a4ac5647`
- **Git status:** limpo (working tree vazio no checkout inicial).
- **Hashes (SHA-256):**
  - `package.json` = `0DEC02F1CC4B518BB839307C0E66EFB05B89590260FBF8E4A84569273A3C220E`
  - `package-lock.json` = `C4B6D53EF3864DBAC79F9E905C0A2D21AA81E4E8E5D318E6E65BA4E994801022`
- **Instalação limpa:** ver `_r3-baseline-install.log` (npm ci dev+optional + rebuild nativos + check-native-deps).
- **Suíte confiável (autoritativa = CI oficial no fork, run `34097249734`, evento workflow_dispatch):**
  **8/8 Unit shards ✓, Integration 1/2+2/2 ✓, Lint ✓, Docs Sync (Strict) ✓, Security Tests ✓.**
  (Baseline "full suite antes das alterações" — item 12.)
- **Build/Vitest (limitações registradas):** falharam **nos runs de fork** (Build = `cancelled`
  no step `npm run build`, hipótese RAM/tempo do runner `ubuntu-latest` vs self-hosted do
  upstream; Vitest UI = 1 file por `tls-client-node` nativo ausente sob install do fork). Ambos
  são **verdes no CI oficial do upstream** para c0b2253 (run 33819289311). Serão comprovados por
  **execução controlada** (runner com RAM equivalente; restaurar `tls-client-node` pelo mecanismo
  oficial + integridade) antes do GO.
- **Deps atuais vs alvo v4.0.7:** bun `1.3.14`→**1.4.0**; `playwright 1.62.1` ok;
  `playwright-core` **ausente**→adicionar `1.62.1`; `tls-client-node ^0.2.0` (optional) presente;
  `@types/bun latest`→`1.4.0`.

## 2. Cópias de banco para teste de migração (item 6)

- **Plano (executado na etapa de banco):** gerar **DB nível 163** (a partir da worktree c0b2253)
  e **DB nível 173** (a partir do checkout f9a1cc8), **anonimizadas** (sem PII/segredos), para
  testar a migração de convergência (P1/P2), **repetição (2×)**, **backup e restore** por hash.
  Guardadas em `docs/evidence/r3/db/` (não versionar dados sensíveis; só hashes/estrutura).

## 3. Mapa dos 10 testes removidos → cobertura substituta (item 7)

> Padrão v4.0.7: **retirada** da integração antiga (v0.1.16) + **reimplementação cleanroom**.
> Nenhuma cobertura é reduzida por nós: portamos os **20 testes adicionados** do upstream; as
> remoções refletem features retiradas/reimplementadas pelo upstream. **Confirmação de
> equivalência ocorre na etapa de testes**; qualquer remoção **sem** substituto/retirement
> dispara PARADA (stop-condition item 11).

|   # | Removido                                         | Substituto / cobertura equivalente (v4.0.7)                                            | Tipo             |
| --: | ------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------- |
|   1 | `chatgpt-web.test.ts` (provider principal)       | `chatgpt-web-cleanroom-provider.test.ts` + `chatgpt-web-first-party-cleanroom.test.ts` | reimplementação  |
|   2 | `chatgpt-web-handoff-resume.test.ts`             | `chatgpt-web-handshake-handoff-cleanroom.test.ts`                                      | reimplementação  |
|   3 | `chatgpt-web-async-image-ws-shapes-7357.test.ts` | `chatgpt-web-image-handler-retirement.test.ts` (+ `chatgpt-web-codex-v4-0-7.test.ts`)  | retire+cleanroom |
|   4 | `chatgpt-web-image-silentdrop.test.ts`           | `chatgpt-web-image-handler-retirement.test.ts`                                         | retire+cleanroom |
|   5 | `chatgpt-web-citations.test.ts`                  | `chatgpt-web-delta-v1-cleanroom.test.ts` / `chatgpt-web-source-retirement.test.ts`     | reimpl./retire   |
|   6 | `chatgpt-web-citations-escape.test.ts`           | idem #5                                                                                | reimpl./retire   |
|   7 | `chatgpt-web-tools-5240.test.ts`                 | `chatgpt-web-executor-adapter-cleanroom.test.ts`                                       | reimplementação  |
|   8 | `chatgpt-web-models-split.test.ts`               | `chatgpt-web-cleanroom-provider.test.ts` (models)                                      | reimplementação  |
|   9 | `chatgpt-web-max-thinking-effort.test.ts`        | `chatgpt-web-codex-v4-0-7.test.ts`                                                     | reimplementação  |
|  10 | `chatgpt-web-sha3-boringssl-5531.test.ts`        | `chatgpt-web-browser-session-cleanroom.test.ts` / `*-runtime-block.test.ts`            | reimpl./retire   |

**Cobertura NOVA adicional (sem remoção correspondente):** `chatgpt-web-retirement`,
`chatgpt-web-management-retirement`, `chatgpt-web-source-retirement`, `chatgpt-web-runtime-block`,
`migration-168-retire-chatgpt-web`, `migration-171-restore-chatgpt-web-cleanroom` (estes dois
últimos validam o efeito que a **migração de convergência** deve reproduzir — a portar como
teste da migração ≥174), + testes de codex (bulk-import, prompt-compression, response-failed,
lite-translated-path, turn-pin).

> **Nota:** as linhas da tabela são **hipóteses baseadas em nome + padrão retire/cleanroom**; cada
> uma será **confirmada lendo o conteúdo** na etapa de testes. Se algum removido não tiver
> substituto/retirement real → **PARAR e apresentar decisão** (não reduzir cobertura).
