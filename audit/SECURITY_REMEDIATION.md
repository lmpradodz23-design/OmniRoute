# SECURITY_REMEDIATION — OmniRoute v3.8.51 (branch `fix/final-user-readiness`)

Consolida, por superfície, cada achado de segurança da missão (`03-SECURITY-FINDINGS.md`) com o estado final, o commit e a evidência (teste de regressão). Convenções: **CORRIGIDO** = causa raiz corrigida com teste RED-first; **ACEITO** = risco residual documentado com justificativa; **BLOCKED_BY_EXTERNAL_DEPENDENCY** = exige credencial/decisão do operador. Detalhes linha a linha: `03-SECURITY-FINDINGS.md` (tabelas "Status após a execução").

## 1. Findings da auditoria anterior (8) — revalidados no código atual

| #   | Finding                                  | Estado                                            | Evidência                                                                                                                                                                                                |
| --- | ---------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SSRF no teste de webhook                 | CORRIGIDO (já no HEAD inicial; endurecido em S-1) | `hardenedWebhookFetch` (DNS pinado, `redirect:"manual"`) + `webhook-dispatcher-ssrf` (10)                                                                                                                |
| 2   | LAN tratada como local (LOCAL_ONLY)      | CORRIGIDO (loopback-only) + **trava** `#2`        | `tests/unit/authz/route-origin-auth-matrix.test.ts` — 144 células rota×origem×credencial×requireLogin (`ee822b5d6`)                                                                                      |
| 3   | `encrypt()` fail-open                    | CORRIGIDO + readiness `#3`                        | `encryptOrThrow`/`assertStorageEncryptionConfigured`; perfil exposto exige `STORAGE_ENCRYPTION_KEY` (`87c4478a5`)                                                                                        |
| 4   | `mcp:connect` alcançava tools de escrita | CORRIGIDO (M-1)                                   | `_meta` nunca é fonte de escopo; enforcement default ON (`0e594e7a6`)                                                                                                                                    |
| 5   | OpenAPI Try confused deputy              | CORRIGIDO (`#5`)                                  | allowlist = operações documentadas; 403 fora dela; sem Cookie/Authorization implícitos (`7cdf5a0a8`)                                                                                                     |
| 6   | Electron IPC remoto                      | CORRIGIDO (E-1/E-2/E-3)                           | `withPrivilegedSender` em 10 canais; nav/redirect cross-origin bloqueados; `sandbox:true` (`f90d3e2d0`)                                                                                                  |
| 7   | API keys em plaintext                    | CORRIGIDO (reveal-once `#7`)                      | validação só por `key_hash`, cifra em repouso; `/reveal` removido (`f9ec8e0ed`); chaves importadas de JSON sem hash **nunca autenticavam** → `deriveApiKeyStorageFields` (`json-import-api-keys-usable`) |
| 8   | Webhook secret em plaintext              | CORRIGIDO                                         | cifra no write, backfill no init                                                                                                                                                                         |

## 2. Por superfície

### 2.1 SSRF / rede outbound (Fase 1 §4)

S-1…S-6 **CORRIGIDOS** (`33b7f20ee`, `4d1d5bff3`, `6afbb8692`, `4a151fb94`, `e690a5bfa`, `d4efe67c4`, `81e8da215`, `9012ea229`, `3b1cf11ba`, `71cc9b5d1`, `9138b87ea`, `da3d0892e`, `b3c604c97`): `privateHost` fechado (FQDN root dot, formas numéricas, `::/96`, `fe80::/10` completo), dispatcher de webhooks, OIDC discovery/token endpoint, gamification federation, Obsidian/Qdrant/memory backends/rerank/translator/agentSkills/healthMonitor/telegram/cloud agents pelo cliente outbound guardado; **S-7 (novo, bug funcional)**: `lookup` pinado compatível com `autoSelectFamily` (`a085e638b`). Política única `areIntegrationPrivateUrlsAllowed()` para integrações configuradas pelo operador. Trava estrutural: `tests/unit/private-host-guard-gaps.test.ts` (59) + suítes por integração.

### 2.2 MCP (Fase 1 §7 / Fase 2)

M-1 CORRIGIDO; R-10 CORRIGIDO (`callerId` real na auditoria, `482511918`); M-2 decisão documentada (`*` = super-usuário intencional, só emitido por principal MANAGEMENT; `2ef9671c4`); R-9 CORRIGIDO (transporte por sessão nos dois endpoints, 404 em sessão desconhecida, cap 64 LRU; `mcp-http-transport-per-session-r9`); R-11 CORRIGIDO (`omniroute_x_search` com orçamento de fetch, `5ce67eb3b`). Verificado ao vivo na Fase 6: initialize por streamable HTTP com chave `mcp:connect` (`tests/e2e/compat-isolated.test.ts`).

### 2.3 Plugins / RCE / traversal (Fase 3)

P-4 (instalação por marketplace **não funcionava** — tarball copiado sem extrair) e P-1 (checksum opcional) CORRIGIDOS em `d28d9066b` (`archive.ts` fail-closed: sem absoluto/`..`/`\`/NUL, limites de entradas/tamanho, SHA-256 obrigatório antes de extrair); P-8 CORRIGIDO (`b40ad2242`); P-6 CORRIGIDO (`contentDispositionAttachment` RFC 6266/5987, `4c710fd9f`/`18951837e`); P-2/P-3 **DISCLOSURE** (`9e4a8cb0a`: SDK e UI declaram que o plugin roda como processo filho com os privilégios do servidor — sandbox real = melhoria futura); P-5 e P-7 **ACEITOS** com justificativa (operador-only / denylist+allowlist no win32).

### 2.4 Guardrails / PII / logs (Fase 4)

Guardrails de credencial, PII e prompt-injection são **mandatórios** (não desligáveis por body/header; `apiKeyInfo` honrado) e **fail-closed** (`dab99d7f7`; `guardrails-mandatory-fail-closed-f4`); paridade `/v1/chat/completions`, `/v1/messages`, `/v1/responses` via `handleChat`; safety net de logs redige cookies/`set-cookie`/`x-omniroute-cli-token`, inclusive em objetos estruturados (`eeea6e3a6`; `log-redaction-cookies-cli-token-f4`); OTEL sem atributos de conteúdo; leitura de memória (Qdrant) usa payload mascarado.

### 2.5 Electron (Fase 1 §1 / Fase 5)

E-1/E-2/E-3/E-7 CORRIGIDOS (`f90d3e2d0`); E-10 HTTPS obrigatório fora de rede privada para Remote Server (`a639938bf`); E-6 órfãos POSIX (`36c6aa58f`, R-12); E-8 sandbox Chromium mantido + cap de contextos (`07d626b10`, R-14); E-9 updater → fork (`e32178574`); **E-5 snapshot pré-update** (`ad95c16ad`: DB+WAL/SHM+`server.env`+`.env`+preferências → `db_backups/pre-update-<v>-<ts>/`, 3 retidos, em ambos os caminhos de instalação); J2 `did-fail-load` (`735ab11c3`). **E-4 code-signing: BLOCKED_BY_EXTERNAL_DEPENDENCY** (certificados do operador — ver `RELEASE_READINESS.md`).

### 2.6 CI / supply chain (Fase 7)

SC-1 strict + composite de secret-scan (`58bfa9be8`); SC-4 scanners pinados com `sha256sum --check` (`9c1284d7a`); SC-5 deploy por versão exata + identidade do fork, `NOT_DEPLOYED` sem executar (`8e6946d1e`); SC-2/6 192 `uses:` → SHA, imagens/pip pinados (`8a32fce7f`, `19544b0b1`); SC-7 `persist-credentials:false` (`a4464d112`); SC-8 Dockerfiles/compose por digest (`ae59709be`); trava `workflows-supply-chain-pins.test.ts` (6). SC-11 falso positivo. **Residuais LOW/MEDIUM rastreados:** SC-3 (`adm-zip` só via `onnxruntime-node`, install-time), SC-9 (download no `postinstall`), SC-10 (`latest` sem quote em `autoUpdate.ts`).

### 2.7 Dados / confiabilidade com impacto de segurança (Fase 2)

R-1 rollback de migração com restore point nomeado e verificado (`audit/ROLLBACK.md`); R-2 escritas multi-tabela transacionais (`deleteApiKey`, `reorderConnections`, `issueRegisteredKey`) e artefato de call-log órfão removido; R-3 retry limitado de `SQLITE_BUSY`; R-4 tolerância a `duplicate column name` só com estado final completo; R-6 shutdown para schedulers antes do drain; **R-21 (Fase 6)** cancelamento do cliente agora aborta o upstream (`bdc34c38e`) — antes o provedor continuava gerando e cobrando tokens após o cliente desconectar.

## 3. Gates de segurança (estado no HEAD)

| Gate                                              | Estado                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Matriz authz rota×origem×credencial (144)         | PASS (trava)                                                                                                                   |
| Matriz MCP escopos / sessões                      | PASS                                                                                                                           |
| SSRF (privateHost + integrações)                  | PASS                                                                                                                           |
| Guardrails mandatórios / redação de logs          | PASS                                                                                                                           |
| Supply chain pins (`workflows-supply-chain-pins`) | PASS                                                                                                                           |
| `npm audit --omit=dev`                            | 0 critical / 0 high (3 moderate: cadeia `adm-zip`/`onnxruntime-node`, install-time) — ver `TEST_MATRIX.md`                     |
| Secret scan (gitleaks)                            | **NOT_RUN** localmente (binário ausente); controle compensatório: sweep regex do diff staged em todo commit; CI estrito (SC-1) |
| semgrep                                           | **NOT_RUN** localmente (binário ausente); CI (`semgrep.yml`, imagem por digest)                                                |

## 4. Recomendações ao operador (fora do código)

1. **Rotacionar** todas as chaves de API coladas no chat durante a missão (nunca foram usadas pela missão; devem ser consideradas expostas).
2. Fornecer certificados de code-signing (Windows/macOS) antes de publicar instaladores (E-4).
3. Habilitar `STORAGE_ENCRYPTION_KEY` em qualquer instalação exposta (a readiness já bloqueia o boot exposto sem ela).
4. Manter `gitleaks` no CI (já estrito) e, se possível, instalá-lo localmente para pre-commit.
