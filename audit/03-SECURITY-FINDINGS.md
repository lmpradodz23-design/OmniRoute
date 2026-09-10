# 03 — Achados de segurança (Fase 0 → insumo da Fase 1)

HEAD auditado: `2a156c73812d45119d5a06a2f55d611280442860` · Fontes: auditor de segurança (ofensivo) + 3 sub-auditorias read-only (SSRF outbound; RCE/traversal/plugins; CI/supply chain), sub-auditoria Electron/updater, sub-auditoria MCP, e verificações do executor (SDK MCP, `gh api`, testes). Nenhum valor de segredo é citado. Classificação: CONFIRMADO · NÃO REPRODUZIDO · CORRIGIDO NO CÓDIGO ATUAL · NOVO · BLOQUEADO POR AMBIENTE · FALSO POSITIVO.

## Gates de segurança neste HEAD

| Gate | Resultado | Evidência |
|---|---|---|
| Regressão dos 8 findings + sanitizador | **64/64 PASS, exit 0** | `node --import tsx/esm --test --test-concurrency=1` (10 arquivos) |
| Dependency scan (prod) | **PASS** no critério Critical=0/High=0 (4 moderate) | `npm audit --omit=dev --json` |
| Secret scan | **NOT_RUN** | `check-secrets.mjs` sai 0 com `SKIP reason=binary-absent` (gitleaks ausente) — ver SC-1 |

## 1. Revalidação dos 8 findings da auditoria anterior (régua = exigências da Fase 1 da missão)

| # | Finding | Fix presente no código atual | Teste | Status | Gap residual vs missão |
|---|---|---|---|---|---|
| 1 | SSRF no teste de webhook | `src/app/api/webhooks/[id]/test/route.ts:37` → `hardenedWebhookFetch` (`src/shared/network/hardenedWebhookFetch.ts`: resolve DNS, valida IPs, pina via lookup, `redirect:"manual"`, sem corpo privado) | `webhook-test-ssrf-rebinding` 18/18 | **CORRIGIDO — PARCIAL** | **S-1 (HIGH):** o dispatcher de **produção** `src/lib/webhookDispatcher.ts:45,:78` valida só hostname (sem DNS) e `:49,:101` `fetch` sem `redirect` (follow) → rebinding e 302→metadata abertos; 4× retry e `res.status` no log = oráculo blind-SSRF; branch Telegram `:187-190` idem. **S-2 (HIGH):** guard canônico `isPrivateHost` com 4 bypasses. Missão: "usar cliente outbound seguro… validar todos os hops" em **toda** saída não confiável. |
| 2 | LAN tratada como local (LOCAL_ONLY) | `src/server/authz/policies/management.ts` sem `isPrivateLanRequest` no gate; loopback-only | `authz/management-policy` 22/22 (+93 regressão) | **CORRIGIDO** | Missão pede separar `LOOPBACK_ONLY` de `TRUSTED_LAN` como conceitos explícitos, garantir que `requireLogin=false` não libere rotas sensíveis e **matriz completa rota×origem×auth** — matriz completa ainda não existe (criar na Fase 1). |
| 3 | `encrypt()` fail-open | `src/lib/db/encryption.ts`: `EncryptionUnavailableError`, `encryptOrThrow`, `encryptSensitive`, `assertStorageEncryptionConfigured` no init (`db/core.ts`); writers convertidos (cloudAgent, commandCodeAuth, services/apiKey, obsidian, radar, settings, logExport/secrets, webhookDispatcher, db/secrets) | `db-encrypt-or-throw` 5/5, `db-secrets-encryption` 22/22 | **CORRIGIDO — PARCIAL** | Missão: exigir `STORAGE_ENCRYPTION_KEY` em perfil exposto/produção; readiness detectar armazenamento inseguro; cifrar `JWT_SECRET`/`API_KEY_SECRET`. **E-7 (MEDIUM):** `electron/main.js:794` grava `server.env` com esses segredos em plaintext sem restringir modo. Readiness/perfil exposto: não verificado. |
| 4 | `mcp:connect` usa tools de escrita | `open-sse/mcp-server/scopeEnforcement.ts:33,39-43` default ON (opt-out só `false/0/no/off`); tool sem escopo declarado é negada (`:129-137`); `withScopeEnforcement` em todo handler (`server.ts:233-280`) | `mcp-scope-enforcement-default` 6/6 (+70) | **CORRIGIDO — PARCIAL** | **M-1 (HIGH, CONFIRMADO):** `scopeEnforcement.ts:101-104` aceita escopos de **`extra._meta` (payload do cliente)** sempre que `authInfo` está ausente/vazio. SDK popula `extra._meta` de `request.params._meta` (`@modelcontextprotocol/sdk/dist/esm/shared/protocol.js:321`). Caminhos: (a) stdio (sem identidade) ignora `OMNIROUTE_MCP_SCOPES`; (b) sessão por **cookie** passa `requireManagementAuth` (`apiAuth.ts:227-242`) mas `resolveMcpCallerAuthInfo` só lê API key (`httpAuthContext.ts:57`) → sem `authInfo` → `_meta:["*"]` libera write/execute/admin; (c) chave com `scopes:[]` (`apiKeys.ts:506,645`) idem. Teste `t08-mcp-scope-enforcement.test.ts:27-39` consagra o fallback. Também: `*` bare concede tudo (`:76-85`); **R-10** audit grava `api_key_id` estático (`audit.ts:374`). |
| 5 | OpenAPI Try confused deputy | `src/app/api/openapi/try/route.ts:96` bloqueia destinos `LOCAL_ONLY`/`ALWAYS_PROTECTED`; same-origin `:81` | `openapi-try-confused-deputy` 6/6 | **CORRIGIDO — PARCIAL** | Missão: remover prefixo genérico `/api/`, allowlist explícita, **não encaminhar Cookie/Authorization**, métodos mutáveis só com autorização específica, preferir serviço interno tipado. A versão mais restritiva foi **revertida** para destravar o CI (mantidos cookie forwarding e métodos mutáveis) → residual **MEDIUM-HIGH**. |
| 6 | Electron IPC remoto | `electron/lib/ipcOriginGuard.js` (`isLoopbackHostname`, `isPrivilegedSenderAllowed`, `isCrossOriginNavigation`); `main.js:1072` `login:start` rejeita sender remoto, valida `providerId`, **não** devolve credentials (persistidas só no main, `:1086-1088`) | `electron-ipc-origin-guard` 7/7 (+25) | **CORRIGIDO — PARCIAL** | **E-1 (HIGH):** `isCrossOriginNavigation` **nunca é ligado a `will-navigate`** (só `isPrivilegedSenderAllowed` importado, `main.js:41`). **E-2 (HIGH):** guard só em `login:start`; `restart-server` (`:1010`), `download-update`/`install-update` (`:1042-1056`), `enable-autostart` (`:1127`), `get-data-dir`, `open-external` ficam invocáveis pela origem remota. **E-3 (MEDIUM):** sem `sandbox` na janela principal (`:403-409`), preload único. HTTPS obrigatório fora de loopback: não verificado. |
| 7 | API keys em plaintext no DB | `src/lib/db/apiKeys.ts`: validação só por `key_hash` (`:447`), chave cifrada em repouso, backfill `encryptExistingApiKeyPlaintext` | `db-apikey-encryption-at-rest` 3/3 (+197) | **CORRIGIDO — PARCIAL** | Missão: persistir **somente hash+prefixo**, revelar plaintext **uma única vez**, remover/redesenhar reveal. Hoje a chave continua armazenada (cifrada — "Opção B") e existe `/api/keys/{id}/reveal` reutilizável (`api-manager/ApiManagerPageClient.tsx:738-760`; doc `QUICK-START.md:82` diz o contrário) → residual **MEDIUM**. |
| 8 | Webhook secret em plaintext | `src/lib/db/webhooks.ts` cifra no write, decifra em `rowToWebhook`, `encryptExistingWebhookSecrets` no init | `db-webhook-secret-encryption` 4/4 (+46) | **CORRIGIDO** | Missão: orientar rotação; nunca retornar segredo completo pela API — "nunca retornar completo" não verificado (LOW). |

## 2. Achados novos e residuais (por superfície)

### 2.1 MCP
| id | Sev. | Class. | Evidência | Impacto | Correção |
|---|---|---|---|---|---|
| M-1 | **HIGH** | CONFIRMADO | ver #4 acima | Escalada de sessão-cookie/stdio/chave-sem-escopo para qualquer tool MCP (memória, Obsidian, plugins, config) | Remover `_meta` como fonte de escopo (só `authInfo` resolvido ou env do operador); definir política explícita para sessão por cookie (negar tools sem chave com escopo, ou mapear escopo server-side); trocar asserção de `t08`; testes de regressão para (a)(b)(c) |
| M-2 | MEDIUM | CONFIRMADO | `scopeEnforcement.ts:76-85` `*` concede tudo | Chave `*` alcança `admin:*` | Exigir escopos explícitos para `admin:*` mesmo com `*` (ou documentar como intencional e auditar emissão) |
| R-9 | MEDIUM | CONFIRMADO | `httpTransport.ts:15,92,298-309` transporte "SSE" singleton | `initialize` de um cliente derruba os demais | Transporte por sessão |
| R-10 | MEDIUM | CONFIRMADO | `audit.ts:374` `api_key_id` = env estático | Auditoria não atribuível ao caller real | Gravar `callerId` resolvido |

**Status após a execução da Fase 1 §7 (branch `fix/final-user-readiness`):**

| id | Estado | Commits | Evidência |
|---|---|---|---|
| M-1 | **CORRIGIDO** | `0e594e7a6` | `_meta` nunca é fonte de escopo (`ScopeSource = authInfo\|env\|none`); sessão por cookie sem chave → sem `authInfo` → só env fallback → com enforcement (default) e sem env, **negado**; `t08` asserção invertida; `tests/unit/mcp-scope-meta-escalation.test.ts` (stdio/cookie/`scopes:[]` com `_meta:["*"]` negados) |
| R-10 | **CORRIGIDO** | `482511918` | `callerContext.ts` (AsyncLocalStorage) + `resolveAuditApiKeyId`; `mcp_tool_audit.api_key_id` = principal real; env id só como fallback stdio; sessão/anonymous nunca gravados |
| M-2 | **DECISÃO + CORRIGIDO (auditoria)** | `2ef9671c4` | `*` mantido como grant super-usuário **intencional** (nenhuma tool exige `admin:*`; só um principal MANAGEMENT emite — `POST /api/keys` é MANAGEMENT-class, provado pela matriz authz). Gap real fechado: `createApiKey` não emitia auditoria alguma e grant/revoke só reconhecia `manage` → `PRIVILEGED_API_KEY_SCOPES = {manage, admin, *}`, evento `apiKey.create {privileged}`, `scopes.grant/revoke` para os três; `tests/unit/mcp-scope-wildcard-semantics.test.ts` (wildcard de família nunca cruza família) |
| R-9 | pendente (Fase 2) | — | transporte SSE singleton — item R-* de confiabilidade |

### 2.2 SSRF / rede outbound
| id | Sev. | Class. | Evidência | Correção |
|---|---|---|---|---|
| S-1 | **HIGH** | CONFIRMADO | `src/lib/webhookDispatcher.ts:45,:78,:49,:101,:94,:187-190` | Rotear pelo `hardenedWebhookFetch` (já existe); validar IP resolvido e cada hop; não expor `res.status` de destinos não públicos |
| S-2 | **HIGH** | CONFIRMADO | `src/shared/network/privateHost.ts:50-56,:93-100`: ponto final (`localhost.`, `metadata.google.internal.`), IPv4-compatible `::7f00:1`, `fe80::/10` só prefixo `fe80:` (perde `feb0::`), literais decimal/octal/hex só seguros via `new URL().hostname`. `src/lib/proxyRelay/privateHostname.ts:18-67` **já corrige os 4** (teste `relay-private-host-guard-gaps.test.ts:31`); 3ª cópia `src/lib/db/upstreamProxy.ts:70` | Portar os 4 para o canônico; colapsar as 3 cópias; teste |
| S-3 | **HIGH** | CONFIRMADO | `src/lib/gamification/servers.ts:74,:136,:172` (URL de `POST /api/gamification/servers`, `route.ts:32` só `z.string().url()`); corpo remoto mesclado no leaderboard | Guard + não refletir corpo |
| S-4 | **HIGH** | CONFIRMADO | `src/app/api/auth/oidc/login/route.ts:49`, `callback/route.ts:106` sem guard; `callback:132` POSTa `client_secret` ao `token_endpoint` **verbatim** do discovery (`:114-115`) | Validar issuer/endpoints (mesma origem do issuer, HTTPS, guard privado) antes de enviar credencial |
| S-5 | MEDIUM-HIGH | CONFIRMADO | `src/lib/obsidian/api.ts:70,:356`; `src/lib/memory/qdrant.ts:177` | Guard (permitir loopback explícito por config, nunca metadata) |
| S-6 | MEDIUM | CONFIRMADO | `memory/genericBackend.ts:269` (`:62-73` só IP literal); `api/translator/send/route.ts:99`; `api/v1/rerank/route.ts:183,:202`; `agentSkills/catalog.ts:207` (`schemas.ts:16`); `versionManager/healthMonitor.ts:17`; `notion/api.ts:101`; `telegram/botApi.ts:56`; `cloudAgent/agents/{cursor:80,codex:35,devin:29}` | Cliente outbound seguro único |
| — | — | LIMPO | `openapi/try:126`, `traffic-inspector replay:43`, `skills/marketplace:44`, `localHealthCheck:118`, `playground/improve-prompt:85`; `safeOutboundFetch.ts` e `providers/validation/transport.ts:111` sólidos (herdam só S-2) | — |

**Status após a execução da Fase 1 §4 (branch `fix/final-user-readiness`):**

| id | Estado | Commits | Evidência |
|---|---|---|---|
| S-2 | **CORRIGIDO** | `33b7f20ee` | `tests/unit/private-host-guard-gaps.test.ts` (59) — FQDN root dot, formas numéricas não canônicas, `::/96`, paridade com `isPrivateRelayHostname` |
| S-1 | **CORRIGIDO** | `4d1d5bff3`, `6afbb8692` | `tests/unit/webhook-dispatcher-ssrf.test.ts` (10), `webhook-abort-timer-cleanup` reescrito, `webhook-test-ssrf-rebinding` (13) |
| S-4 | **CORRIGIDO** | `4a151fb94` | `src/lib/auth/oidcDiscovery.ts` + `tests/unit/oidc-discovery.test.ts` (26); residual LOW: `jose.createRemoteJWKSet` (JWKS) usa fetch próprio, não pinado |
| S-3 | **CORRIGIDO** | `e690a5bfa` | `tests/unit/gamification-servers-ssrf.test.ts` (13); validação na escrita + `FederationUrlError` → 400 |
| S-5 | **CORRIGIDO** | `d4efe67c4`, `81e8da215`, `9012ea229`, `3b1cf11ba` | `guardedFetch` (11), `obsidian-ssrf` (14), `qdrant-routes` (stand-in loopback + metadata + redirect), `generic-backend` vitest (38) |
| S-6 | **CORRIGIDO** | `71cc9b5d1`, `9138b87ea`, `da3d0892e`, `b3c604c97`, + rerank/translator/agentSkills (ver log) | `healthMonitor` (13), `cloud-agent-outbound-guard` (3) + `cursor-4227` stand-in, `telegram-botapi-outbound-guard` (4, token nunca vaza), `local-rerank-logging` (5), `translator-send-outbound-guard` (4); trava estrutural `tests/unit/outbound-sinks-no-bare-fetch.test.ts` (17 sinks + 2 clientes) |
| **NOVO (S-7)** | **CORRIGIDO** | `a085e638b` | **Bug funcional real**: o `lookup` pinado (desde `7488e1cbf`) respondia só a forma legada; com `autoSelectFamily` (Node ≥ 20) todo alvo por **hostname** falhava ("Invalid IP address: undefined") em S-1/S-3/S-4/S-5 — `pinnedLookup()` compartilhado + `tests/unit/pinned-lookup-hostname.test.ts` (4, prova viva com Host header preservado) |

Política adotada para integrações configuradas pelo operador (Obsidian, Qdrant, memory backends, tools do version manager, Bot API do Telegram, cloud agents, rerank local, translator/send): `areIntegrationPrivateUrlsAllowed()` = mesma precedência local-first dos providers (`getProviderOutboundGuard() !== "public-only"`); **metadata de nuvem nunca**, redirects nunca seguidos, conexão pinada ao endereço validado. Webhooks/federação/OIDC mantêm a política estrita (`arePrivateProviderUrlsAllowed`, opt-in explícito).

### 2.3 RCE / traversal / plugins (Fase 3)
| id | Sev. | Class. | Evidência | Correção |
|---|---|---|---|---|
| P-0 | — | LIMPO | Nenhum `exec()` string, `new Function`, `eval` em `src/`; spawns argv-array; `plugins/manager.ts:79-100,456` containment com `realpath`; `routeGuard.ts:32-83` loopback-gate antes do auth em todas as superfícies de spawn/exec | Preservar |
| P-1 | MEDIUM-HIGH | CONFIRMADO | `src/lib/plugins/marketplace.ts:234` checksum **opcional**; registro (`:151`) fornece URL e hash; sem assinatura; `loader.ts:165-181` integrity opcional | Checksum obrigatório + assinatura de publisher |
| P-2 | MEDIUM | CONFIRMADO | `manifest.ts:11` declara `network/file-read/file-write/exec`, só `env` é aplicada (`loader.ts:211,419-436`) | Aplicar (Node permission model no filho) ou parar de anunciar + **disclosure obrigatório** na UI/docs |
| P-3 | MEDIUM | CONFIRMADO | `loader.ts:224` `spawn(process.execPath, …)` sem `--permission` | Idem P-2 |
| P-4 | BUG | CONFIRMADO | `marketplace.ts:223,244` grava `plugin.tar.gz`; `manager.ts:191` copia o tarball **sem extrair** → instalação por marketplace **não funciona** | Implementar extração segura (traversal, symlink, bomb, limites, checksum, tmp isolado, cleanup) ou desabilitar com mensagem clara |
| P-5 | MEDIUM | CONFIRMADO | `src/lib/middleware/registry.ts:118,132` `vm.Script` in-process (sandbox sem `process/require/fetch`, `codeGeneration:false`, timeout); escape por prototype-chain possível; rota loopback (`routeGuard.ts:58`) | Documentar como código confiável do operador; considerar worker isolado |
| P-6 | LOW | CONFIRMADO | `api/files/[id]/content/route.ts:29-30` `Content-Disposition` sem escape | Escapar/usar `filename*` |
| P-7 | LOW | CONFIRMADO | `src/lib/acp/registry.ts:322-334` `shell:true` no win32 (neutralizado por denylist `:201` + `requireBinaryMatch:302-310` + allowlist `:209,:314`) | Remover `shell:true` |
| P-8 | INFO | CONFIRMADO | `skills/install/route.ts:19` `handlerCode` nunca avaliado (`executor.ts:245-259`) | Renomear/remover campo enganoso |

**Status após a execução da Fase 3 (branch `fix/final-user-readiness`):**

| id | Estado | Commits | Evidência |
|---|---|---|---|
| P-4 | **CORRIGIDO (bug real)** | `d28d9066b` | `src/lib/plugins/archive.ts` — extração tar.gz fail-closed (só arquivos/diretórios; sem absoluto/`..`/`\`/NUL; limites 2 000 entradas / 16 MiB / 64 MiB; sem owner/mode; manifesto na raiz ou em uma única pasta); `installMarketplaceEntry` extrai e instala o diretório do plugin; `tests/unit/plugins-marketplace-archive.test.ts` (11, RED-first) |
| P-1 | **CORRIGIDO** | `d28d9066b` | checksum SHA-256 **obrigatório** e verificado antes de qualquer extração; sem checksum → recusa antes do download; assinatura de publisher continua **não implementada** (registro não a publica) — registrado como melhoria futura |
| P-2 / P-3 | **DISCLOSURE (decisão)** | `9e4a8cb0a` | `PLUGIN_SDK.md` afirmava "sandboxed VM context" — falso; agora declara: processo filho com privilégios do servidor, só `env` é aplicado; aviso `role="note"` na página Plugins (en/pt-BR); `tests/unit/plugins-trust-disclosure.test.ts` trava o texto e detecta adoção futura de `--permission`. Enforcement via permission model = follow-up, não afirmado |
| P-8 | **CORRIGIDO** | `b40ad2242` | `handlerCode` → `handler` (alias deprecado mantido), validado contra `builtinSkills` → 400 `UNKNOWN_SKILL_HANDLER` com a lista; `tests/unit/skills-install-handler.test.ts` (4) |
| P-6 | **CORRIGIDO** | `4c710fd9f`, `18951837e` | `contentDispositionAttachment` (RFC 6266/5987; controle/CRLF removidos, `filename*`); `tests/unit/content-disposition.test.ts` (6) |
| P-7 | **ACEITO (LOW, documentado)** | — | No win32 o Node exige shell para `.cmd/.bat` (CVE-2024-27980); a superfície já é fechada por denylist de metacaracteres, `requireBinaryMatch` e allowlist de um único flag de versão (`SAFE_VERSION_PROBE_ARG`). Remover `shell:true` quebraria a detecção de agentes instalados via npm no Windows |
| P-5 | **ACEITO (operador-only, documentado)** | — | hooks `vm.Script` in-process são código do operador, rota loopback-gated; worker isolado = melhoria futura |
| SC-3 | **ACEITO (MEDIUM, rastreado)** | `1aa4df0db` (hono) | `adm-zip` só via `onnxruntime-node` em tempo de instalação (unpack do runtime), fora de qualquer caminho de request; fix exige downgrade major de `onnxruntime-node`; `hono` corrigido (3 advisories) |

### 2.4 Electron (Fase 1 #6 / Fase 5)
E-1 (HIGH) nav block inerte; E-2 (HIGH) guard só em `login:start`; E-3 (MEDIUM) sem sandbox/preload único; E-4 (HIGH, release) sem code-signing (`electron/package.json`); E-5 (HIGH) sem rollback/backup pré-update; E-6 (MEDIUM) órfãos POSIX; E-7 (MEDIUM) `server.env` sem `0o600`; E-8 (MEDIUM) `--no-sandbox` no browser pool; E-9 (Fase 8) updater aponta ao upstream. Detalhes em `02-ARCHITECTURE.md` e checkpoint. Positivos: `contextIsolation`, sem `nodeIntegration`, sem `webviewTag`, login em janela isolada, credenciais nunca ao renderer.

**Status após a execução da Fase 1 §1 / §3 / §5 / §6 / §2:**

| id | Estado | Commits | Evidência |
|---|---|---|---|
| E-1 | **CORRIGIDO** | `f90d3e2d0` | `will-navigate`/`will-redirect` → `blockCrossOriginNavigation` (`shouldBlockNavigation`); `setWindowOpenHandler` deny |
| E-2 | **CORRIGIDO** | `f90d3e2d0` | `PRIVILEGED_IPC_CHANNELS` (10) todos por `withPrivilegedSender` (valida `event.sender`/`senderFrame`/origem; remoto negado) |
| E-3 | **CORRIGIDO** | `f90d3e2d0` | `sandbox:true` na janela principal; preload da prompt remota separado e mínimo (padrão já existente) |
| E-7 | **CORRIGIDO** | `f90d3e2d0` | `electron/lib/ownerOnlyFile.js` — `server.env` gravado com `0o600` + chmod |
| **E-10 (novo; "E-4 HTTPS" no checkpoint/commit)** | **CORRIGIDO** | `a639938bf` | HTTPS obrigatório fora de rede privada para a URL de Remote Server (`isPrivateNetworkHost`); prompt valida no main via invoke/handle e mostra o motivo; `tests/unit/electron-remote-server-transport.test.ts` (RED 3 → 10/10) |
| E-4 (code-signing) | `BLOCKED_BY_EXTERNAL_DEPENDENCY` | — | certificados do operador; registrar em `RELEASE_READINESS.md` |
| E-5 / E-6 / E-8 / E-9 | pendentes (Fases 5 / 2 / 3 / 8) | — | rollback pré-update; `detached`/PID POSIX; `--no-sandbox` browser pool; publish → `LMPrado-DZ23` |
| #5 OpenAPI Try | **CORRIGIDO** | `7cdf5a0a8` | allowlist = operações **documentadas no spec** (`documentedOperations.ts`, catch-all excluído) → 403 fora dela; cookie de sessão **nunca** encaminhado; mutáveis só com `confirmMutation`; `apiKeyId` → `Authorization` injetado server-side (por isso a chave cifrada em repouso continua necessária — ver #7) |
| #7 API keys | **CORRIGIDO (reveal-once)** | `f9ec8e0ed` | `/api/keys/{id}/reveal` removido (+ UI/doc); chave mostrada por completo só na criação/regeneração. **Opção A (só hash+prefixo) avaliada e NÃO adotada:** o plaintext cifrado (`enc:v1:`, fail-closed em produção, validação por `key_hash`) é consumido pelo Try server-side (#5) e pela integração de agentes; `ALLOW_API_KEY_REVEAL` re-escopada só para credenciais de provedores |
| #3 Criptografia/readiness | **CORRIGIDO** | `87c4478a5` | `deploymentProfile.ts` (`isExposedDeploymentProfile` = produção **ou** bind explícito ≠ loopback) exige `STORAGE_ENCRYPTION_KEY`; `storageEncryptionAudit.ts` conta linhas sensíveis sem `enc:v1:` (valores nunca retornados); `/api/monitoring/health` (visão management) expõe `storage.status ∈ {ok, encryption_disabled, insecure_storage}`. Cifrar `JWT_SECRET`/`API_KEY_SECRET` em repouso = **N/A** (são as raízes de chave; proteção = arquivo `0o600`, E-7) |
| #2 Matriz authz | **CORRIGIDO (trava)** | `ee822b5d6` | `tests/unit/authz/route-origin-auth-matrix.test.ts` — 144 células rota×origem×credencial×requireLogin, todas conforme o contrato (nenhuma correção de produção necessária) |

### 2.5 CI / supply chain (Fase 7)
| id | Sev. | Class. | Evidência | Correção |
|---|---|---|---|---|
| SC-1 | HIGH | CONFIRMADO | `scripts/check/check-secrets.mjs` advisory; mesmo `--ratchet` sai 0 com binário ausente | Scanner ausente **falha** o gate de release; modo estrito |
| SC-4 | HIGH | CONFIRMADO | `ci.yml:361` `bash <(curl …actionlint/main…)`; `:349-382` `gh release download` sem tag (gitleaks/osv/oasdiff); `:933` `npm install -g bun` | Replicar `quality.yml:224-233` (versões + checksum) |
| SC-5 | HIGH | CONFIRMADO | `deploy-vps.yml:59` `omniroute@latest`; `:47` `appleboy/ssh-action@v1` com `VPS_SSH_KEY` | Versão+digest exatos; action SHA-pinada; health/smoke; `NOT_DEPLOYED` se host inacessível (sem executar deploy) |
| SC-2/6 | MEDIUM | CONFIRMADO | `ci.yml:476` `vale-action@reviewdog`; `semgrep.yml:19` imagem sem digest; `docker-publish.yml:482` `sbom-action@v0`; `pip install schemathesis/garak` sem versão | Pinar |
| SC-7 | MEDIUM | CONFIRMADO | `wiki-sync.yml:40`, `nightly-release-green.yml:378` sem `persist-credentials:false` em `contents: write` | Adicionar |
| SC-8 | MEDIUM | CONFIRMADO | `Dockerfile:2,44`, `Dockerfile.bun:2`, compose por tag | Digest; remover `npm@latest` |
| SC-9/10 | LOW | CONFIRMADO | `postinstall.mjs:170` download em install; `flake.nix` `npm install`; `autoUpdate.ts:288,297-310` `latest` sem quote | Pinar/`npm ci`; `shellQuote` |
| SC-11 | — | **FALSO POSITIVO** | Tags `checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8`, `cache@v6`, `github-script@v9` **existem** (verificado `gh api`; `ci.yml:38` já usa o SHA de `checkout@v7`) | Na Fase 7, converter os `uses:` restantes por tag para SHA |
| SC-3 | MEDIUM | CONFIRMADO | `adm-zip` symlink via `onnxruntime-node` (não participa de plugins) | Avaliar downgrade/isolamento da cadeia ONNX |
| — | — | POSITIVO | `codeql.yml`/`semgrep.yml` actions SHA-pinadas; Trivy SHA-pinado; `npm-publish.yml` npm@11.15.0 + `--ignore-scripts`; nenhum `pull_request_target`; inputs via `env:` | Preservar |

**Status após a execução da Fase 7 (branch `fix/final-user-readiness`):**

| id | Estado | Commits | Evidência |
|---|---|---|---|
| SC-1 | **CORRIGIDO** | `58bfa9be8` | `check-secrets.mjs --strict` (binário/baseline ausente → exit 1, `secretFindings=FAIL reason=binary-absent`); composite `.github/actions/secret-scan` (gitleaks 8.30.1 + checksum) chamado em `docker-publish`, `electron-release`, `npm-publish`; `tests/unit/build/check-secrets.test.ts` +4 (inclui spawn e2e com PATH vazio). Gate local continua `NOT_RUN` (binário não instalado neste host) |
| SC-4 | **CORRIGIDO** | `9c1284d7a` | ci.yml: gitleaks/osv/actionlint/oasdiff pinados + `sha256sum --check` contra o checksum da mesma release; sem `curl | bash` de `main`; bun `1.4.0` nos dois SOs |
| SC-5 | **CORRIGIDO (sem deploy)** | `8e6946d1e` | deploy-vps: versão exata (`inputs.version` ou tag do publish), `npm view omniroute@X repository.url` deve apontar para `LMPrado-DZ23/OmniRoute` senão `NOT_DEPLOYED`; pós-install confere versão; ssh-action SHA-pinada. Nenhum deploy executado |
| SC-2/6 | **CORRIGIDO** | `8a32fce7f`, `19544b0b1` | 192 `uses:` → SHA (vale-action branch e sbom-action@v0 incluídos); `semgrep/semgrep:1.176.1@sha256:34ab61…`; `schemathesis==4.26.1`, `garak==0.17.0` |
| SC-7 | **CORRIGIDO** | `a4464d112` | `persist-credentials: false` em `wiki-sync` e `nightly-release-green` |
| SC-8 | **CORRIGIDO** | `ae59709be` | `FROM node:26-trixie-slim@sha256:…`, `oven/bun:1.4.0-slim@sha256:…`, `npm@11.15.0`; compose: redis/qdrant/bifrost/cli-proxy-api por digest |
| SC-11 | FALSO POSITIVO (confirmado) | — | tags existem; agora todas convertidas para SHA de qualquer forma |
| SC-3 / SC-9 / SC-10 | pendentes | — | `adm-zip` via `onnxruntime-node` (downgrade major a avaliar); `postinstall` download em install-time; `autoUpdate.ts` `latest` sem quote — Fase 2/9 |
| **Trava** | — | `8e6946d1e` | `tests/unit/workflows-supply-chain-pins.test.ts` (6): ações SHA, scanners com checksum, pip pinado, imagens por digest, deploy sem `@latest`, checkouts write sem token |

### 2.6 Superfícies verificadas sem achado
Command injection (argv-array em todos os spawns); path traversal por request; `new Function`/`eval`; injeção em workflows (inputs via `env:`); `pull_request_target`; `openapi/try` same-origin + denylist; OAuth login Electron (janela isolada, credenciais nunca ao renderer); secret-pattern no repositório (auditoria anterior: "no issue found"; revalidação local bloqueada — SC-1).

## 3. Priorização para a Fase 1 (maior risco primeiro)

1. **S-1 + S-2 + S-3 + S-4** — SSRF: rotear dispatcher, OIDC, gamification, Obsidian/Qdrant pelo cliente outbound seguro; corrigir e unificar `isPrivateHost`. (Fase 1 §4)
2. **M-1** — remover `_meta` como fonte de escopo MCP; política para sessão-cookie; corrigir `t08`. (Fase 1 §7)
3. **E-1 + E-2 + E-3** — ligar `will-navigate`, guard em todo IPC privilegiado, `sandbox`/preload mínimo. (Fase 1 §1)
4. **#5 residual** — allowlist explícita, sem Cookie/Authorization implícitos, mutáveis só autorizados. (Fase 1 §3)
5. **#7 residual** — reveal único; avaliar Opção A (só hash+prefixo). (Fase 1 §5)
6. **#3 residual** — `server.env` `0o600`; readiness de armazenamento inseguro; exigir chave em perfil exposto. (Fase 1 §6)
7. **#2 matriz** — teste matricial rota×origem×auth. (Fase 1 §2)
8. **SC-1/SC-4/SC-5** — gates de supply chain (Fase 7); **P-1…P-4** (Fase 3).
