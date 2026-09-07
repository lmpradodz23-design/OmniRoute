# R3-A — resumo final da implementação + lacunas honestas + fronteira do gate final

> Worktree `repos/OmniRoute-r3-c0b2253` (branch `r3-backport-base`) sobre baseline verde
> `c0b2253`. Gate geral **NO-GO**; Fase 1 bloqueada até o gate final (runtime) passar.

## 1. Commits R3-A (9, um por etapa — item 12)

|   # | Commit      | Etapa                                                                   |
| --: | ----------- | ----------------------------------------------------------------------- |
|   1 | `2cabab94e` | deps (bun 1.4.0, playwright-core 1.62.1, @types/bun 1.4.0)              |
|   2 | `15b3e22f6` | vendor codex-chatgpt-web v4.0.7 (18A/28M/1D)                            |
|   3 | `7a54fd344` | browserPool.ts + obscura.ts (storageState; compartilhado, regressão OK) |
|   4 | `371aa0f76` | utils+constantes cleanroom (10 A)                                       |
|   5 | `077d0b3cb` | executores chatgpt-web (6M/3D)                                          |
|   6 | `1a508e298` | providers registry (credential-gated)                                   |
|   7 | `67b30af67` | migração 174 de convergência (idempotente/aditiva, P1/P2 validadas)     |
|   8 | `5056f1536` | testes cleanroom (6 suites, 52/52) + retirada dos antigos               |
|   9 | `eba89307a` | changelog fragment                                                      |

## 2. Gates verdes (saídas reais)

- **Escopo:** 90 arquivos únicos vs baseline (teto R3-A: 150). Folga ~60.
- **typecheck:core** (oficial): **0 erros**. **noimplicit:core**: só pré-existente (`pureHelpers`).
- **eslint** (oficial): 0 nos arquivos alterados.
- **testes cleanroom chatgpt-web:** 52/52 pass (browser-session, codex-v4-0-7, delta-v1,
  executor-adapter, first-party, handshake-handoff).
- **regressão browserPool** (compartilhado): 10/10 pass (não quebra claude-web/poolTools).
- **migração 174:** P1 (base 163) e P2 (release 173) convergem ao mesmo estado (byte-idêntico
  módulo CRLF); idempotente 2×; comportamento correto (cgpt-web desabilitado, chatgpt-web
  canônico permitido); não-destrutivo. Ver `_r3a-migration174-validation.txt`.
- **secret scan:** limpo.
- **Cascata da release NÃO materializou:** o único arquivo compartilhado exigido foi
  `browserPool` (1 campo `storageState`) + `obscura` (node builtins). Nenhum
  `base.ts`/`combo`/`db central`/`auth`/`oauth` precisou ser importado.

## 3. Lacunas honestas (NÃO fake-green; documentadas, não escondidas)

Estas exigiriam importar **subsistemas compartilhados** cuja mudança é majoritariamente
**evolução de release não-relacionada** — o que arriscaria regredir outros providers
(stop-trigger item 8). Por isso foram **deixadas de fora da R3-A**, não mascaradas:

- **Provider config completo** (`cleanroom-provider.test.ts`, 2 asserções): exige
  `src/shared/constants/providers/web-cookie.ts` (139/150 linhas **não-chatgpt**:
  deepseek/qwen/grok/…) para `toolCalling: "none"`, e `webCookieAuth.ts` (genérico) para a
  validação de storage-state de sessão (`expires:-1`). Portar = reconciliar o subsistema
  web-cookie compartilhado → risco de regressão de outros web-providers.
- **Retirada estrita dos arquivos legados v0.1.16** (5 testes de _retirement_): exige remover
  `chatgptImageCache.ts`, `chatgptTlsClient.ts`, `imageGeneration/providers/chatgptWeb.ts`,
  a rota de imagem antiga, etc., cujos importadores (`imageGeneration.ts` = **381/409 linhas
  não-chatgpt**: Flux/Gemini/grok/ideogram/imagen/…; `webProvidersA.ts`) são release-coupled.
  Os arquivos legados permanecem **inertes** (provider retido por padrão) — dead-code tolerado,
  não caminho ativo. Uma retirada completa é trabalho futuro isolado.
- **Rota `/v1/messages/count_tokens`** (polimento de erro de retirada): a versão f9a1cc8 usa
  `credentials.allRateLimited`/`connectionId` (tipo de auth da release) → não portada. As rotas
  `/v1/messages` e `/v1/responses` do baseline **já atendem** o requisito público.

## 4. Fronteira do gate final (item 11) — DEPENDÊNCIA EXTERNA

O gate final exige **prova em runtime**: login no ChatGPT Web, storage seguro de sessão,
`/v1/messages`, `/v1/responses`, streaming, ferramentas, retomada, erros/timeouts, redação de
credenciais, reinício sem processo órfão. Isso requer **o login do operador no ChatGPT** —
ação humana externa que o agente **não pode** e **não deve** executar (política de credenciais).

**Portanto:** a R3-A está **código-completa e validada estática/unitariamente**; o **GO da
Fase 0 depende** do operador habilitar o provider com uma storage-state real e das provas de
runtime acima. Até lá, gate geral permanece **NO-GO** e a Fase 1 **bloqueada** — sem verde
artificial.
