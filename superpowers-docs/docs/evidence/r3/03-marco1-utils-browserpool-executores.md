# R3-A — Marco 1: utils + browserPool + executores (item 13)

> Worktree `repos/OmniRoute-r3-c0b2253` (branch `r3-backport-base`). Gate geral **NO-GO**;
> Fase 1 bloqueada até R3-A verde. Provider chatgpt-web ainda **inerte** (credential-gated).

## Commits desta etapa (sobre baseline verde `c0b2253`)

| Commit      | Escopo                                                                |
| ----------- | --------------------------------------------------------------------- |
| `2cabab94e` | deps (bun 1.4.0, +playwright-core 1.62.1, @types/bun 1.4.0) — etapa 2 |
| `15b3e22f6` | vendor codex-chatgpt-web v4.0.7 (18A/28M/1D) — etapa 3                |
| `7a54fd344` | browserPool.ts + obscura.ts (storageState p/ v4.0.7; compartilhado)   |
| `371aa0f76` | utils+constantes cleanroom (10 A)                                     |
| `077d0b3cb` | executores chatgpt-web (6 M / 3 D; consolidação 13→9)                 |
| `1a508e298` | providers registry chatgpt-web{,-codex} (credential-gated)            |

## Escopo vs teto (item 8)

- **72 arquivos únicos** alterados desde `c0b2253` (29 A / 4 D / 39 M). **Teto: 150.** Folga ~78.
- Codex standalone (codex.ts/tools, codexIdentity, nativeCodexTurnPin, codexResponses) **NÃO**
  tocado — provado desnecessário à integração chatgpt-web (typecheck 0 ao revertê-los ao baseline).
- browserPool foi o **único** arquivo compartilhado exigido — por 1 campo (`storageState`); nenhum
  subsistema (base.ts/combo/db/auth/oauth) precisou ser importado. Cascata **não** materializada.

## Resultados dos gates (item 13) — saídas reais

| Gate                                    | Ferramenta oficial                                             | Resultado                                                                                      |
| --------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Typecheck core                          | `tsc -p tsconfig.typecheck-core.json`                          | **EXIT 0 — 0 erros**                                                                           |
| Typecheck noimplicit                    | `tsc -p tsconfig.typecheck-noimplicit-core.json`               | só erros **pré-existentes** em `translator/.../pureHelpers.ts` (0 novos nos arquivos portados) |
| Typecheck focado (18 arquivos portados) | tsconfig ad-hoc c/ `files`                                     | **0 erros**                                                                                    |
| Lint                                    | `eslint` (config do repo) nos 20 arquivos alterados            | **EXIT 0**                                                                                     |
| Regressão browserPool                   | `node --test browserPool-proxy + browser-pool-optional-import` | **10/10 pass, 0 fail**                                                                         |
| Secret scan                             | grep de chaves/segredos nos arquivos tocados                   | **limpo**                                                                                      |

## Pendências honestas (não são falhas; são etapas seguintes)

- **Testes chatgpt-web v4.0.7 (cleanroom, 20A/14M/10D):** ainda **não portados** (commit próprio,
  item 12). Os testes chatgpt-web do baseline referenciam os executores antigos removidos (D) e por
  isso não rodam agora — **esperado**; serão substituídos pelos cleanroom (mapa em doc 00).
- **Rotas `/v1/messages`, `/v1/responses`, `count_tokens`** (3 M): pendentes — commit providers/rotas.
- **Migração de convergência ≥174:** pendente (impõe o estado durável "desabilitado até operador").
- **Instalação limpa + suíte completa + integração (CI oficial):** deferidas ao **gate final** (deps
  inalteradas desde a etapa 2; reinstalação no Windows é frágil e sem valor incremental aqui).
- **Gate final (item 11):** habilitar o provider em ambiente controlado e provar login, storage de
  sessão, `/v1/messages`, `/v1/responses`, streaming, ferramentas, retomada, erros/timeouts, redação
  de credenciais, reinício sem órfão. **Só então** GO da Fase 0.

## Próximo

Continuar dentro do teto e sem regressões (item 14): **rotas `/v1`** → **migração ≥174** →
**testes cleanroom** → **docs** → **gate final**. Fase 1 não inicia até R3-A comprovadamente verde.
