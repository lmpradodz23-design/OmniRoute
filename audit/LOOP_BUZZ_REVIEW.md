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

## 2. Auditor B — Security / DevSecOps (relatório integral)

Confirmado: o lado Loop commitado no HEAD `4b70d75ec` é byte a byte o que auditei (`git diff 8ffc8a6dc HEAD -- <loop>` vazio); as 10 modificações no working tree do Loop são do outro agente e **não fazem parte desta auditoria**. O lado Buzz no working tree só difere no refactor de `useEffect` de `buzz/page.tsx` (commit `6986295c0`, já revisto — sem impacto de segurança). Segue o relatório final.

---

## Relatório final — Auditor B (Security / DevSecOps) — Loop Engine + Buzz Hub

**Base auditada:** `R = C:/Users/zodyp/Downloads/OmniRoute-Unified/repos/OmniRoute-v3851-port`, branch `feat/loop-buzz-on-v3851`, escopo Loop pelo conteúdo commitado (`git show HEAD:…`, HEAD `4b70d75ec`, idêntico a `8ffc8a6dc`) e Buzz pelo working tree. Linhas citadas referem-se ao conteúdo commitado. Somente leitura: nada editado/commitado por mim.

**Efeitos colaterais divulgados:** `check-route-guard-membership.ts` abriu o DB real `C:\Users\zodyp\.omniroute\storage.sqlite` e rodou o migration runner (aditivo/idempotente); `audit-dashboard-pages.mjs` gravou `R/scripts/i18n/_audit.json` (gitignored).

**Verificações executadas (output real):** 7 testes novos **36/36 pass**; ESLint escopo **0 erros**; `tsc -p open-sse/tsconfig.json` **0 erros**; `tsc -p tsconfig.typecheck-api.json` 289 pré-existentes, **0 no escopo**; `check-route-validation` PASS (contornado — H2); `check-error-helper`, `check-db-rules`, `check-migration-numbering`, `check-fetch-targets`, `check-openapi-routes`, `check-deps` OK; `lockfile-lint` direto OK. PoCs (a)–(e) executados a partir do scratchpad, sem tocar no repo.

### HIGH

**H1 — Chave secreta Nostr em texto puro em `key_value`, fora da criptografia em repouso e da auditoria**

- Evidência: `R/src/lib/buzzService.ts:24-35` grava `generateSecretKey()` cru em `('buzz','agent_sk')`; sem `encryptSensitive` (`R/src/lib/db/encryption.ts:281`); `R/src/lib/db/storageEncryptionAudit.ts:34` só cobre `namespace='secrets'`. PoC: `row.value === sk → true | looksEncrypted → false`.
- Causa: namespace novo sem seguir a convenção (`webhooks.ts:105`).
- Impacto: backup/export do DB vaza a identidade do agente → impersonation no relay (assinatura + NIP-42). Viola CLAUDE.md §6.
- Correção: `encryptSensitive` na escrita, `decrypt` na leitura; incluir `key_value where namespace='buzz'` em `SENSITIVE_COLUMNS`.
- Teste: com `STORAGE_ENCRYPTION_KEY`, `looksEncrypted(row.value)` e chave estável entre chamadas.

**H2 — Gate T06 contornado; 4 rotas mutáveis sem schema → budget anulável e entradas sem limite**

- Evidência: `R/scripts/check/check-route-validation.mjs:9` regex `request\.json\(`; rotas usam `req.json()` (`R/src/app/api/loop/route.ts:50`, `[id]/advance/route.ts:22`, `[id]/approve/route.ts:23`, `R/src/app/api/buzz/route.ts:30`). PoC: regex casa `req.json(` = false. `budget` sem validação → `createLoopRun` spread (`R/open-sse/loop-engine/index.ts:37`); PoC: `maxTokens:"abc"` + 999.999.999 tokens → `report_only`, `checkBudget.ok=true` (`budget.ts:34`, NaN). `pattern/taskId/correlationId` sem limite, persistidos (`loopEngine.ts:55`) e copiados ao outbox (`buzzProducer.ts:39`).
- Impacto: "estourou → aborta" anulável por token `write`; DoS de disco; gate reporta PASS falso.
- Correção: zod + `validateBody()` nas 4 rotas (budget inteiro positivo com teto; `pattern ≤128` `[A-Za-z0-9._-]`; ids ≤64); regex do gate `\b\w+\.json\s*\(`.
- Teste: gate com fixture `req.json(`; POST `/api/loop` com `budget.maxTokens:"abc"` → 400.

**H3 — `approveStep` ignora o Policy Gate; kinds AUTONOMY_DENIED viram "approved" e o gate nunca roda**

- Evidência: `R/src/lib/loopRunner.ts:80-90` não exige `awaiting_approval`, nem `step.status==="proposed"`, nem re-avalia `decideEffect`; `stateMachine.ts:60` só avalia `proposed`. PoC: step `delete` pré-aprovado → `approved`, run atravessa `execute` (`note "-> checkpoint"`); idem `purchase`.
- Impacto: invariante "código decide" (`policyGate.ts:13-28`) falso no estado persistido; qualquer executor futuro que confie em `approved` executa efeito negado. Mitigação: nada executa hoje.
- Correção: exigir `awaiting_approval` + `proposed` e `decideEffect(effect,{reportOnly:false}).outcome!=="deny"`; senão 409.
- Teste: aprovar `delete`/`purchase` → erro; aprovar sem `awaiting_approval` → erro.

### MEDIUM

**M1 — Aprovar/trocar relay/flush exigem só escopo `write`; sem linha na matriz de autz** — `R/src/server/authz/accessScopes.ts:52-62` (prefixos ausentes; o próprio arquivo pede adição para rotas sensíveis); zero ocorrências de loop/buzz em `src/server/authz` e `tests/unit/authz`. Fallback MANAGEMENT ok (`classify.ts:111-126`); `requireManagementAuth` nos 6 handlers; key de cliente sem `manage` → 403 (`requireManagementAuth.ts:141-156`). Correção: `/api/loop`, `/api/buzz` em `ADMIN_MUTATION_PREFIXES` + linha em `route-origin-auth-matrix.test.ts`. Teste: `inferRequiredScope("POST","/api/loop/x/approve")==="admin"`.

**M2 — URL do relay sem guarda de rede** — `R/src/app/api/buzz/route.ts:36` só `/^wss?:\/\//`; `wsAdapter.ts:49` conecta a qualquer host. PoC: aceitos `ws://user:pass@10.0.0.5`, `ws://169.254.169.254/`, `wss://attacker.example`. Guardas existentes não reutilizadas (`outboundUrlGuard.ts:74`, `privateHost.ts:113`; `parseOutboundUrl:95` só http/https). Com M1: token `write` redireciona o relay e o flush envia outbox + AUTH assinado. Correção: `new URL`, rejeitar creds embutidas, bloquear metadata sempre, privado salvo loopback/política, `wss://` fora de loopback. Teste: cada URL acima → 400; `ws://localhost:3000` → 200.

**M3 — Adapter WS sem `maxPayload`, validação de shape, backpressure, reconexão ou deadline** — `wsAdapter.ts:49` (default 100 MiB, `node_modules/ws/lib/websocket.js:675`); `:107-111` só verifica assinatura; `buzzConsumer.ts:40` persiste sem cap; sem `close` handler; flush 50×8 s sem deadline (`flush/route.ts`). **NÃO VERIFICADO dinamicamente** (sem relay). Correção: `maxPayload:1<<20`, `perMessageDeflate:false`, validar kind/content ≤64 KiB/tags, deadline total. Teste: servidor `ws` local com 2 MiB → descartado.

**M4 — `err.message` bruto ao cliente e status errado** — `advance/route.ts:29-32`, `approve/route.ts:34-37` (qualquer erro vira 404), `flush/route.ts:26-29` (erros do `ws` com hostname/DNS); nada via `createErrorResponse` (`errorResponse.ts:12`). Correção: erros tipados, mensagem genérica no flush, detalhe só em log redigido. Teste: relay inalcançável → body sem hostname.

**M5 — Budget de tempo é "honor system"** — `stateMachine.ts:49` soma só o `consumed` do chamador; só `attempts` é auto-imposto (`:83`); `maxWallClockMs` nunca medido. Correção: medir a partir de `created_at` (coluna já existe). Teste: `maxWallClockMs=1` + `created_at` passado → `aborted` sem `consumed`.

**M6 — i18n: 6 chaves inexistentes e páginas hard

C:\Users\zodyp\Downloads\Nova pasta>oded** — `featureFlagDefinitions.ts:663,675`, `sidebarVisibility/sections.ts` (`loopEngine`, `loopEngineSubtitle`, `buzzHub`, `buzzHubSubtitle`): 0 ocorrências em `src/i18n/messages/*.json`; `audit-dashboard-pages.mjs`: ambas as páginas `t() calls=0`, strings pt-BR hardcoded. Correção: chaves em `en.json` + `useTranslations`; teste espelhando `tests/unit/settings-i18n-keys.test.ts` / `gamification-admin-sidebar-i18n.test.ts`. (`i18n:check` FAIL é em `docs/security/*.md [pl]`, não atribuível ao branch.)

### LOW

- **L1** Tenant: PK global `buzz_outbox.id`/`buzz_inbox.event_id` (`175_….sql:43,57`); `enqueueOutbox` relê sem tenant (`buzzBridge.ts:60-62`); `markOutbox` sem tenant (`:94-100`); `saveLoopRun ON CONFLICT(id)` sem tenant (`loopEngine.ts:57`); rotas sempre `DEFAULT_TENANT`. Teórico hoje.
- **L2** `GET /api/buzz` (flag OFF) gera e persiste a chave secreta como efeito colateral de leitura (`buzzService.ts:93`).
- **L3** `BUZZ_RELAY_URL` não documentada (0 ocorrências em `.env.example`/docs); default `ws://localhost:3000` colide com porta usual do Next dev.
- **L4** 6 rotas novas ausentes de `docs/openapi.yaml` (gate passa com threshold 30%).
- **L5** Painel: "Aprovar" e "Salvar relay" sem confirmação; `relayUrl` (possivelmente com creds, M2) exibido e retornado no status.

### IMPROVEMENT

- **I1** `startBuzzInboxSubscription` sem callers em `src/` — consumidor não integrado (bom para fail-closed no boot; pendência funcional).
- **I2** Considerar `approve`, `PUT /api/buzz`, `flush` em `ALWAYS_PROTECTED_API_PATHS` (`routeGuard.ts:128`) sob `requireLogin=false`.
- **I3** `approveStep` sem audit trail de quem aprovou.

### FALSE_POSITIVE / VERIFICADO OK

- XSS via Buzz: inbox nunca renderizado; React escapa; sem `dangerouslySetInnerHTML`.
- Boot com flag OFF: nada inicia; flush → `skipped`; `resolveBuzzAdapter` → `Disabled` (`index.ts:32`); rotas Loop → 404. Defaults `"false"` (`featureFlagDefinitions.ts:666,678`).
- IDOR por id: `getLoopRun` filtra tenant (`loopEngine.ts:93-97`) com teste; não explorável hoje.
- Supply chain: `@noble/*` 2.4.0 pinados, sha512, `registry.npmjs.org` (`package-lock.json:6942-6960`), allowlisted (`74927a4b3`); `lockfile-lint` OK. **NÃO VERIFICADO:** `check-licenses` (binário ausente).
- Migração 175: aditiva, `IF NOT EXISTS`, `tenant_id` + índices, não destrutiva; outbox idempotente por PK real.
- Segredo não aparece em logs/erros/respostas (só `agentPubkey`) — mas ver H1.
- Gates `check-lockfile`/`check-*-typecheck` falham por `spawnSync npx.cmd EINVAL` (Node 24/Windows — ambiente); `check-openapi-security-tiers`/`check-file-size` falham em arquivos fora do diff (pré-existente).

---

### Veredito: **REPROVADO** (para publicação neste estado)

Flags OFF e report-only contêm o raio de dano, mas H1 viola regra inegociável de segredos, H2 anula o budget e contorna um gate do repo, e H3 quebra o invariante "código decide". Ordem de correção antes de publicar:

1. **H1** — criptografar `agent_sk` em repouso + auditoria de armazenamento.
2. **H3** — `approveStep` respeitar estado + `decideEffect`.
3. **H2** — schemas zod nas 4 rotas + corrigir regex do gate T06.
4. **M2** — guarda de rede na URL do relay.
5. **M1** — prefixos em `ADMIN_MUTATION_PREFIXES` + linha na matriz.
6. **M4** — sanitizar erros.
7. **M3** — `maxPayload`, shape do evento, deadline do flush.
8. **M5** — wall-clock medido pelo motor.
9. **M6** — chaves i18n + `useTranslations`.
10. L1–L5, I1–I3 em follow-up.

**Nota:** as edições em andamento no working tree do Loop (10 arquivos, outro agente) podem já endereçar H2/H3/M4/M5 — precisam de re-auditoria após commit; este relatório não as cobre.
