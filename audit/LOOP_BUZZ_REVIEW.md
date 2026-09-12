# Loop Engine + Buzz Hub — revisão independente (missão 2, 2026-09-12)

Branch `feat/loop-buzz-on-v3851` (12 commits transplantados de `fase-1-loop-buzz` sobre `release/v3.8.51`). Três auditores sem acesso às conclusões uns dos outros; consolidação e fix loop na §4.

## 1. Auditor A — Architect / Engineering (relatório integral)

# Auditoria A — Architect/Engineering — `feat/loop-buzz-on-v3851`

Base: `origin/release/v3.8.51` · 12 commits · 40 arquivos (+3050/−1). Somente leitura; nada editado.

## Evidência executada (saída real)

| Verificação                                                                       | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7 testes (`node --test` c/ harness do repo: tsx + setupPolyfill + isolateDataDir) | **36/36 pass**, 0 fail, 3.8 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `typecheck:core` (tsc)                                                            | **0 erros**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tsc -p open-sse/tsconfig.json` (direto)                                          | **0 erros**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tsc -p tsconfig.typecheck-dashboard.json` / `-api.json` (direto)                 | 201 / 289 erros, **todos pré-existentes** (agent-skills, cache, cli-code, combos…); **zero** menção a loop/buzz                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `eslint` (config principal) nos 35 arquivos                                       | **FALHA — 2 erros** `react-hooks/set-state-in-effect` (loop/page.tsx:103, buzz/page.tsx:54). Reproduzido também com `--suppressions-location config/quality/eslint-suppressions.json` → `npm run lint` quebra → `npm run check` quebra                                                                                                                                                                                                                                                                                                                                               |
| `eslint -c eslint.complexity-ratchets.config.mjs`                                 | 9 erros: `advance` complexity 17 / cognitive 26; `BuzzHubPage` 223 linhas / complexity 19; `LoopEnginePage` 256 linhas + arrow de 103 linhas; (FeatureFlagsGrid: pré-existente)                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gates OK                                                                          | migration-numbering, db-rules, route-guard-membership, openapi-routes, openapi-coverage (98.4ratchet), api-docs-refs, docs-symbols, changelog-integrity, error-helper, route-validation:t06, any-budget:t11, fetch-targets, test-discovery, complexity-ratchets (2758 < baseline 3218), cognitive-complexity, cycles, circular-deps, deps ("nenhuma nova dep" — @noble já na allowlist), secrets, public-creds, test-masking, test-runner-api, i18n:check-ui-coverage                                                                                                                |
| Gates FALSE_POSITIVE / ambiente Windows                                           | `check:lockfile` (rodei `lockfile-lint` direto no lock da base e do HEAD: **"No issues detected"** nos dois; @noble tem https + sha512); `check:file-size` (core.ts 1770>1745 — arquivo **não** tocado pela branch); `check:openapi-security-tiers` (6 rotas volcengine, pré-existente); `dead-code`/`licenses`/`type-coverage`/`duplication`/`forgotten-sibling-tests`/`open-sse-typecheck`/`dashboard-typecheck` → binário ausente, `spawnSync npx.cmd EINVAL` ou config inexistente → **NÃO VERIFICADO pelo gate** (tsc verificado direto acima; knip verificado por grep abaixo) |

## 1. Integração com a base atual — contratos conferidos

- `getDbInstance()` de `./core` + `db.transaction(...)`: mesmo padrão dos repos da base (`src/lib/db/a2aTasks.ts:199`, `agentBridgeBypass.ts:51`). OK.
- `runWithBusyRetry` (`src/lib/db/adapters/busyRetry.ts:67`) é usado **só** dentro dos adapters (`betterSqliteAdapter.ts`, `nodeSqliteShared.ts`); repos não o chamam. Loop/Buzz não precisam chamar. OK.
- `requireManagementAuth(req)` → `Promise<Response|null>` (`src/lib/api/requireManagementAuth.ts:52-55`): uso correto nas 6 rotas. Classificação authz: fallback MANAGEMENT (`src/server/authz/policies/management.ts`); rotas não são spawn-capable → `check:route-guard-membership` OK. Nenhuma matriz explícita exige registro.
- `isFeatureFlagEnabled(key: string)` (`src/shared/utils/featureFlags.ts:26`) aceita string livre; flags adicionadas ao catálogo `FEATURE_FLAG_DEFINITIONS`. OK.
- `guardedFetch`/`safeOutboundFetch`: não se aplica (transporte é `ws`, como `open-sse/executors/chipotle.ts:84` e `src/lib/vncSession/harvest.ts:40`). `check:fetch-targets` OK.
- `open-sse/utils/error.ts`: gate `check:error-helper` só cobre `open-sse/executors|handlers` → não atinge as rotas; ver L4.
- Imports com extensão `.ts`: convenção da base (506 arquivos em open-sse; `allowImportingTsExtensions: true`). `@noble/*` e `ws ^8.21.3`/`@types/ws` presentes.
- Shutdown: `registerShutdownHook` existe (`src/lib/shutdownHooks.ts:24`) mas **nada** do Loop/Buzz o usa — e, como está, nada de longa duração é instanciado (ver H2).
- **Nenhuma chamada a API inexistente ou com contrato divergente.** `key_value (namespace,key,value, PK(namespace,key))` (`core.ts:305-310`) compatível com `INSERT OR REPLACE` do buzzService.

## 2. Como Loop/Buzz se ligam ao resto

- Runner = funções puras chamadas pelas rotas; sem singleton, sem timers no import (grep: nenhum `setInterval` fora de `wsAdapter.publish/connect`).
- Produtor: `advanceRun` → `notifyLoopEvent` (`loopRunner.ts:65-72`) → `enqueueOutbox`. **Ligado.**
- Consumidor: `startBuzzInboxSubscription` — **0 chamadas em src/** (grep). Não é instanciado em `src/instrumentation-node.ts`, rota ou custom server.
- Flush do outbox: só manual via `POST /api/buzz/flush`; nenhum job em `src/lib/jobs/*`.
- Endpoint AG-UI `/api/loop/[id]/stream`: **0 referências** em páginas/runner/rotas/open-sse (grep `ag-ui|agui|/stream`). Nada quebra sem ele.

## Achados

### HIGH

**H1 — `npm run lint` quebra (bloqueio de publicação).** `src/app/(dashboard)/dashboard/loop/page.tsx:103` e `buzz/page.tsx:54`: `useEffect(() => { void load(); }, [load])` com `load` chamando `setLoading(true)` síncrono → `react-hooks/set-state-in-effect` (error). Causa: padrão diferente do da base (`a2a/page.tsx:164` usa IIFE async). Impacto: `npm run check` (lint && test) falha. Correção mínima: `useEffect(() => { void (async () => { await load(); })(); }, [load])` ou não chamar `setLoading(true)` sincronamente no início. Teste: eslint do arquivo com exit 0.

**H2 — Consumidor Buzz não está ligado (commit 8ffc8a6dc diz "wiring produtor/consumidor").** `src/lib/buzzConsumer.ts:26 startBuzzInboxSubscription` sem chamadores; `getBuzzAdapter` idem. Impacto: inbox é caminho morto; contador "Inbox recebidos" do painel nunca sai de 0; `buzz_inbox` nunca é escrita; sem shutdown hook. Correção mínima (escolher uma, honestamente): (a) ligar em `src/instrumentation-node.ts` atrás de `BUZZ_HUB_ENABLED` + `registerShutdownHook("buzz-inbox", sub.stop)`; ou (b) tirar consumidor/inbox/card do escopo v1. Teste RED: com flag ON e relay fake, evento recebido → `buzz_inbox` tem 1 linha; `requestGracefulShutdown` → `adapter.close()` chamado.

**H3 — Outbox "idempotente com retry" não tem retry no caminho de produção + corrida NIP-42.** `src/lib/db/buzzBridge.ts:94-101 markOutbox(...,"failed")` → status `failed`; `pendingOutbox` (l.76-81) só lê `pending`; não existe `requeueFailed` no repo DB (só na classe in-memory `Outbox`, **não usada em produção**). `wsAdapter.ts:56-59` resolve `connect()` 400 ms após `open` sem esperar a resposta do AUTH; `buzz-relay` tem `auth_required` → primeiro `publish` pode receber `OK false auth-required` → entrada vira `failed` **para sempre**; painel mostra "Falhas" sem ação. Correção mínima: `pendingOutbox` → `status IN ('pending','failed') AND attempts < N ORDER BY sequence_number`; `connect()` resolver só após `OK` do evento 22242 (ou timeout). Teste RED: relay fake (`ws.Server`) que envia `AUTH` e responde `OK false` até autenticar; `flushBuzzOutbox` deve publicar; entrada `failed` deve se

C:sers\zodyp\Downloadsova pasta>r retentada no flush seguinte.

### MEDIUM

**M1 — `budget` do `POST /api/loop` não validado.** `src/app/api/loop/route.ts:52,62` faz cast `Record<string,number>` e espalha em `LoopBudget` (`open-sse/loop-engine/index.ts:37`). `{budget:{maxTokens:"x"}}` → `usage.tokens > "x"` = false → invariante "estourou → aborta" contornável por input do cliente; chaves extras entram no JSON persistido. Correção: validar 3 campos numéricos finitos > 0 (400 caso contrário). Teste RED: POST com `maxTokens:"x"`/`-1`/`NaN` → 400.

**M2 — Idempotência do advance sob concorrência entre processos.** `src/lib/db/loopEngine.ts:57-59` upsert sem guarda otimista; `advanceRun` (`loopRunner.ts:56-62`) é read→advance→write. Em um processo é serializado (tudo síncrono, sem `await` entre leitura e escrita) — **duas requisições simultâneas no mesmo Next não corrompem**. Entre processos (cenário que a base suporta — `busyRetry.ts` existe para "another process holds the lock") é last-writer-wins: `sequenceNumber` N+1 gravado duas vezes, uma transição perdida. `enqueueOutbox`/`receiveInbox` (`MAX(sequence_number)+1` sem UNIQUE) têm o mesmo perfil. Correção: `UPDATE … WHERE id=@id AND sequence_number=@expected` → 0 changes ⇒ 409; RMW em `db.transaction` imediata. Teste RED: dois `saveLoopRun` a partir do mesmo snapshot; segundo deve falhar.

**M3 — Dívida nova de complexidade** (saída do `eslint.complexity-ratchets.config.mjs` acima). O gate passa por ratchet global, mas o código novo adiciona 7 violações. Correção: dividir `advance` em `applyPolicyGate/applyVerdict/finishOrNext`; extrair `RunCard`, `StepRow`, `RelayUrlCard`, `IdentityCard`.

**M4 — Painel fora dos padrões da base.** Sem `useTranslations` (a2a/mcp/plugins usam 5/5/2×); 100% dos textos hardcoded em PT-BR numa base EN-first (inclusive `sidebarVisibility/sections.ts` `subtitleFallback: "Ciclos report-only + aprovações"` vs. vizinhos "Multi-model parallel execution"); chaves `loopEngine/buzzHub/loopEngineSubtitle/buzzHubSubtitle` ausentes em **todos** os locales (fallback literal); 0 `data-testid`; "Rejeitar" sem `ConfirmModal` (exportado por `src/shared/components/Modal.tsx`). Correção: chaves em `en.json` + `i18n:sync-ui`, `t()`, `data-testid`, ConfirmModal no reject. Teste: RTL do card com locale en.

**M5 — Docs.** 6 rotas novas ausentes de `docs/openapi.yaml` (grep 0 hits; coverage passa só por ratchet 98.4%) enquanto o changelog as anuncia. `BUZZ_RELAY_URL` (`buzzService.ts:46`) ausente de `.env.example` e `docs/reference/ENVIRONMENT.md`; `check:env-doc-sync` passou **vacuamente** aqui (usa `grep -rhoE … || true` via `execSync`, l.320-323 — no CI Linux vai acusar "var no código ausente de .env.example"). Fragment `changelog.d/features/loop-engine-and-buzz-hub.md` sem prefixo `<PR-number>-` exigido pelo `changelog.d/README.md`.

**M6 — Segredo Nostr em texto puro no `key_value`** (`buzzService.ts:30-33`), enquanto a base tem `encrypt()/isEncryptionEnabled()` em `src/lib/db/encryption.ts:167,185`. Não vaza para o modelo nem para a API (status expõe só pubkey — verificado), mas é segredo em repouso fora da convenção. Coordenar com auditor de segurança.

### LOW / IMPROVEMENT

- **L1** `rejectStep` (`loopRunner.ts:93`) diz que o run "pode escalar/abortar no próximo advance", mas `stateMachine.ts` não trata `rejected`: o run volta a `report_only` (l.104) e cicla até o budget. Sugerir: `rejected` sem `proposed` ⇒ `escalated`.
- **L2** `wallClockMs` só cresce via `consumed` do chamador; a rota permite omitir → teto de tempo não é auto-imposto (contraste com `attempts`, que o motor conta). Calcular a partir de `created_at`.
- **L3** `wsAdapter`: `close()` não limpa timers de `publish` nem resolve `pendingOk` (timers órfãos até `timeoutMs`, não `unref`); `ws.send` em socket não-OPEN lança síncrono (`ws/lib/websocket.js:382-401`) dentro do executor → `publish` rejeita → `/flush` devolve 502 com `e.message` cru (pode conter host:porta do relay). Guardar `readyState`, limpar timers, `createErrorResponse`.
- **L4** Rotas usam `NextResponse.json({error})` ad hoc (majoritário na base: 309 vs 113 `createErrorResponse`) — aceitável, exceto o 502 do flush.
- **L5** Itens de sidebar sem `featureFlagKey` (base suporta gate opt-in, `types.ts:159`); aparecem com flag OFF. IMPROVEMENT.
- **L6** Exports órfãos (knip não instalado → verificado por grep): `Outbox`, `Inbox`, `budgetPressure`, `isAutoExecutable`, `buzzIdentityIsMapped`, `nostrKeyAuthorizes`, `emptyUsage`, `DEFAULT_LOOP_BUDGET`, `runsAwaitingApproval`, `getBuzzAdapter`, `startBuzzInboxSubscription` — os 3 últimos estão em `src/**` (dentro do `project` do knip) e serão apontados pelo `check:dead-code` no CI.
- **L7** Upsert de `loop_runs` faz `ON CONFLICT(id) DO UPDATE` sem cláusula de tenant.
- **L8** Testes fazem `exec` manual da migração 175 (`ensureSchema`) em vez de confiar no runner — mascararia falha de registro da migração (o runner varre o diretório e o gate de numeração passou, então hoje é redundante, não errado).

### FALSE_POSITIVE

`check:lockfile`, `check:file-size`, `check:openapi-security-tiers`, erros de tsc dashboard/api — todos pré-existentes ou ambientais (evidência na tabela).

## 5. Testes — o que cobrem e o que falta

Cobrem comportamento real: budget, policy gate (deny/require/allow), transições da state machine, persistência round-trip + isolamento por tenant, dedup do outbox/inbox no DB, `createdAt` estável, assinatura/verificação Nostr (tamper), produtor no `awaiting_approval`, flag OFF ⇒ flush `skipped`.
**Faltam (RED-first exigidos):**

1. `WebSocketBuzzAdapter` contra relay fake `ws.Server`: AUTH 22242 → OK; EVENT verificado chega ao callback; `OK false` ⇒ `publish=false`; timeout.
2. `flushBuzzOutbox` com flag ON (relay fake): publica, marca `published`, retenta `failed` (H3).
3. Rotas: 401/403 sem auth (`requireManagementAuth` com `alwaysRequireAuth`), 404 com flag OFF em todas as 5 rotas gated, `PUT /api/buzz` rejeita `http://`, `POST /api/loop` valida `budget` (M1).
4. Concorrência: dois saves do mesmo snapshot ⇒ conflito (M2).
5. Consumidor + shutdown: `startBuzzInboxSubscription` grava em `buzz_inbox`; hook de shutdown fecha o socket (H2).
6. `rejectStep` ⇒ próximo advance escala (L1); `wallClockMs` auto-medido (L2).

## Veredito: **COM RESSALVAS** — não publicar antes de H1–H3 e M1

Ordem de correção:

1. H1 (lint quebra CI) — 2 linhas.
2. H3 (retry do outbox + `connect()` esperar AUTH) + teste com relay fake.
3. H2 (ligar consumidor com shutdown hook **ou** cortar do escopo e do painel).
4. M1 (validar budget).
5. M2 (guarda otimista por `sequence_number`).
6. M5 (openapi das 6 rotas; `BUZZ_RELAY_URL` em `.env.example`/ENVIRONMENT.md; renomear fragment).
7. M4 (i18n/ConfirmModal/data-testid) e M3 (dividir `advance` e as páginas).
8. M6 (encrypt da secret key) — alinhar com auditor de segurança.
9. L1–L7.

**NÃO VERIFICADO:** gates `dead-code`, `licenses`, `type-coverage`, `duplication`, `forgotten-sibling-tests` (ferramenta ausente/EINVAL neste checkout Windows); comportamento contra um `buzz-relay` real (nenhum teste de integração existe); `check:env-doc-sync` em Linux (inferido pelo código do gate, não executado).
