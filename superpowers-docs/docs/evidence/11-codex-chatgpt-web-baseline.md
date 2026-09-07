# 11 — codex-chatgpt-web — Baseline (Fase 0)

**Auditor:** agente executor (baseline, read/verify apenas — sem alterações funcionais).
**Data:** 2026-09-06.
**Escopo:** `C:\Users\zodyp\Downloads\OmniRoute-Unified\repos\codex-chatgpt-web` (somente).
**Objetivo:** preparar runtime (reparar Bun isolado), rodar verificações e registrar evidências reais. Sem login real no ChatGPT; sem impressão de segredos/cookies.

---

## 1. Ambiente / SHA

```
$ git -C repos/codex-chatgpt-web rev-parse HEAD
c648c09501bb1b704c7ad5273fb5f5d6b8992dd2      # == SHA congelado esperado ✅

$ git status --porcelain
(vazio — working tree limpo, nenhum arquivo alterado pelo audit)
```

Disco C: no início `48G` livres / no fim `64G` livres (nunca abaixo do limiar de ~8G).

```
$ df -h /c
C:  931G  867G  64G  94% /c
```

`package.json` exige **Bun 1.4.0** (`"packageManager": "bun@1.4.0"`, `"engines": { "bun": "1.4.0" }`, `@types/bun@1.4.0`).

---

## 2. Reparo do Bun (isolado)

**Estado inicial — shim npm quebrado (confirmado):**

```
$ which bun
/c/Users/zodyp/AppData/Roaming/npm/bun

$ bun --version
/c/Users/zodyp/AppData/Roaming/npm/bun: line 12:
  C:\Users\zodyp\AppData\Roaming\npm/node_modules/bun/bin/bun.exe: No such file or directory
exit=127            # QUEBRADO (aponta para bun.exe inexistente) ✅ conforme previsto
```

**DECISÃO ASSUMIDA:** usar o Bun oficial já instalado em `~/.bun/bin/bun.exe` (isolado, em `%USERPROFILE%\.bun`) em vez de rodar o instalador — justificativa: o binário isolado já existia e já reportava a versão exigida, opção menos invasiva, não toca nenhum config global do usuário nem o shim npm quebrado.

```
$ ls -la ~/.bun/bin
-rwxr-xr-x  88825944  Aug 20 01:03  bun.exe
-rwxr-xr-x  88825944  Aug 20 01:03  bunx.exe

$ ~/.bun/bin/bun.exe --version
1.4.0            # ✅ versão final == 1.4.0 (não foi necessário upgrade/downgrade)
```

Todos os comandos abaixo usam `BUN=~/.bun/bin/bun.exe` (binário isolado). O shim quebrado em `AppData\Roaming\npm` NÃO foi tocado/removido.

---

## 3. Instalação (`bun install --frozen-lockfile`)

Usa `bun.lock` versionado. Rodado com `--frozen-lockfile` para não mutar o lockfile congelado.

```
$ ~/.bun/bin/bun.exe install --frozen-lockfile
bun install v1.4.0 (34cbb9a40)
+ @types/bun@1.4.0
+ @types/turndown@5.0.5
+ typescript@5.9.3
+ @modelcontextprotocol/sdk@1.30.0
+ ajv@8.20.0
+ ajv-formats@3.0.1
+ chromium-bidi@12.1.0
+ fflate@0.8.3
+ playwright-core@1.62.0
+ tiktoken@1.0.22
+ turndown@7.2.0
+ turndown-plugin-gfm@1.0.2
+ zod@4.4.3
108 packages installed [38.48s]
EXIT=0           # ✅ sucesso
```

Nota: apenas as dependências da raiz foram instaladas. O sub-workspace `launcher/` tem seu **próprio `bun.lock`** e NÃO foi instalado (traria Electron, ~centenas de MB, fora do escopo baseline). Isso explica 4 falhas de teste — ver §5.

---

## 4. Typecheck

O script `typecheck` (`bunx tsc --noEmit`) falhou por um **problema do shim `bunx` no Windows** (não é erro de código):

```
$ ~/.bun/bin/bun.exe run typecheck
$ bunx tsc --noEmit
O sistema não pode encontrar o caminho especificado.
error: script "typecheck" exited with code 1   # falha do resolvedor bunx, não do TS
```

Invocando o compilador diretamente pelo install local (equivalente ao `--noEmit`):

```
$ ~/.bun/bin/bun.exe x tsc --noEmit
EXIT=0           # ✅ typecheck LIMPO — zero erros de tipo
```

Veredito typecheck: **PASSA** (TypeScript strict compila sem erros; a falha do wrapper `bunx` é um detalhe de ambiente Windows, não do código).

---

## 5. Testes (`bun test tests/*.test.ts`)

Rodado com timeout de 360s. Executou por completo em ~226s.

```
$ ~/.bun/bin/bun.exe test tests/*.test.ts
...
error: Cannot find package 'electron' from
  '...\codex-chatgpt-web\launcher\electron\browser-host.cjs'
...
 651 pass
 4 fail
 3019 expect() calls
Ran 655 tests across 49 files. [225.72s]
EXIT=1
```

**651 passam / 4 falham.** As 4 falhas têm **causa raiz única e idêntica**: `Cannot find package 'electron'` — o pacote `electron` não está instalado porque o workspace `launcher/` (que tem lockfile separado) não foi instalado neste baseline. São testes de integração que carregam o helper real `launcher/electron/browser-host.cjs`. Falhas identificadas (re-rodando os arquivos afetados):

- `tests/zero-risk-adapter.test.ts` (3):
  - `Zero Risk v1 compaction resumes with exact launcher ownership (final wins: false)`
  - `Zero Risk v2 compaction resumes with exact launcher ownership (final wins: false)`
  - `Zero Risk v2 compaction resumes with exact launcher ownership (final wins: true)`
- `tests/launcher-helper-client.test.ts` (1):
  - `daemon streams browser lifecycle through the real helper process`

Nenhuma falha é defeito de lógica do repo — todas são ausência da dependência `electron` (gap de ambiente, resolvível com `bun install` dentro de `launcher/`). **Deferido:** instalar deps do `launcher/` fica fora do escopo baseline (peso do download de Electron); registrar como pendência para quem for exercitar os testes de launcher.

---

## 6. Notas de smoke (o que exige login)

Os scripts de smoke NÃO fazem parte de `bun test`; são invocados por `package.json` scripts separados:

- `smoke` → `scripts/smoke-release.ts dist/runtime` — exige build de runtime (`bun run build`) antes; não roda sem o bundle compilado.
- `smoke:codex` → `scripts/smoke-codex-catalog.ts`
- `smoke:cancel` / `smoke:interrupt` / `smoke:subagents` → scripts `smoke-codex-*.ts`
- `smoke:subagents:live` → `scripts/smoke-codex-web-subagents.ts`

**AUTH_REQUIRED — deferido para Fase 2:** qualquer smoke que exercite uma sessão ChatGPT Web autenticada (fluxo `codex`/`live`, turnos de browser reais) requer **login humano** no ChatGPT via a partição Electron persistente do launcher. Conforme instrução de segurança, NÃO foi feito login real, NÃO foram copiados cookies/sessão. Esses smokes ficam **requer login humano (AUTH_REQUIRED) — deferido para Fase 2**.

---

## 7. Arquitetura / contratos (leitura de README, docs/, SECURITY.md, src/ — sem executar login)

Fonte: `docs/architecture.md`, `docs/security-model.md`, `SECURITY.md`, `src/server.ts`, `src/config.ts`.

**O que é:** ponte (bridge) local de Responses API que roda tarefas do **Codex** através de uma sessão **ChatGPT Web autenticada pelo usuário**. Ele começa onde a API oficial termina: expõe modelos "ChatGPT Web" ao Codex sem chave de API de modelo.

**Fluxo de topo:**

```
Codex app/CLI --(Responses API em loopback)--> daemon codex-chatgpt-web (dono: launcher)
   ├─ passthrough /models oficial + modelos fixos ChatGPT Web
   ├─ passthrough Responses nativo OU bridge ChatGPT Responses/SSE
   ├─ worker de browser ChatGPT (até 5 abas Electron atadas à tarefa)
   ├─ capability broker (só em modo full)
   └─ servidor MCP stdio
        ▲  (túnel de saída OpenAI)  →  conector custom do ChatGPT
```

**Runtime / launcher (Bun):**

- Cada pacote desktop nativo embute Electron + um **Bun fixado por plataforma** + a bridge Responses + código Playwright + servidor MCP + setup/doctor + helper de browser.
- O **launcher é o único supervisor de processos** (macOS/Windows/Linux): sobe o túnel (opcional), espera evidência healthy/ready, sobe o daemon Responses, e espera o payload de health versionado.
- Runtime embarcado é validado contra manifesto determinístico (path/size/SHA-256) antes de abrir porta/janela.

**src/ (principais):** `cli.ts` (entrada), `server.ts` (daemon HTTP Responses + endpoints admin), `config.ts` (config, bind loopback), `bridge.ts` (ponte, o maior — ~50KB), `chatgpt-session.ts`/`chatgpt-web-models.ts`/`browser-login.ts` (sessão/modelos/login Web), `codex-integration*.ts` (integração Codex, journal, rota), `launcher-browser-host.ts` (host Electron), `tunnel*.ts` (túnel), `native-passthrough.ts`, `model-catalog.ts`, `doctor.ts`, `setup.ts`.

**Mecanismo de comunicação / portas / health (confirmado em código):**

- **Loopback obrigatório:** `config.ts` fixa `host: "127.0.0.1"` e **valida** — `if (parsed.host !== "127.0.0.1") throw new Error("The Responses proxy must bind to 127.0.0.1")`. Proxy Responses e health ligam SOMENTE a loopback.
- **Porta padrão:** `17841` (`config.ts` default; `contextWindow: 256000`).
- **Health/readiness:** endpoint **`GET /healthz`** (`server.ts:791`). O launcher espera o payload de health versionado antes de considerar o daemon pronto.
- **Endpoints de ciclo de vida (admin):** `POST /admin/drain`, `/admin/resume`, `/admin/cancel-turn`, `/admin/interrupt-turn`, `/admin/cancel-turns`, `/admin/shutdown` — protegidos por **bearer token aleatório de propriedade da aplicação** (armazenado no config user-only). Drenagem exige dois contadores zerados (requests HTTP Responses ativos + sessões de browser ativas) antes de parar.
- **Token por turno (modo full):** o daemon cria um token aleatório _turn-scoped_, embutido em UM prompt de browser; toda ação Codex Native apresenta esse mesmo token ao handler MCP, que reivindica um binding interno + lease de atividade e despacha a ação. Segredos internos **nunca** são expostos ao modelo.
- **Túnel (modo full):** HTTPS de saída (Secure MCP Tunnel da OpenAI) — não abre listener público nem regra de firewall de entrada. Chave de runtime precisa só de Tunnels Read+Use, armazenada user-only, referenciada por arquivo, nunca em argumento de linha de comando.
- **Modelo exposto ao Codex:** o daemon repassa o catálogo oficial autenticado e **acrescenta** apenas os modelos roteados do namespace `chatgpt-web/` (Instant/`light`, Medium, High, Extra High, e `pro` se a conta expõe Pro). Prewarm WebSocket do provider nativo recebe `HTTP 426` (sinal de negociação de capacidade do Codex) para trocar para transporte HTTP/SSE — sem fallback de modelo/provider.

**Invariantes de segurança (docs + SECURITY.md):** bind loopback-only; estado de browser/credenciais de túnel sob home da app com `0600`; endpoints de ciclo de vida com bearer aleatório; nunca segredos em args/logs/profiles/Git; máximo 5 abas task-bound; sem retry/troca de modo para burlar limites de uso. Conteúdo de repo/tool/web é tratado como **dado não confiável** (injeção de prompt é risco principal reconhecido).

---

## 8. Veredito

**codex-chatgpt-web constrói/executa isolado (sem login)? → PARCIAL (favorável).**

Justificativa:

- ✅ **Runtime reparado isolado:** Bun 1.4.0 funcional via `~/.bun/bin/bun.exe`, sem tocar config global do usuário; shim npm quebrado deixado intacto.
- ✅ **Instalação:** `bun install --frozen-lockfile` = EXIT 0, 108 pacotes, lockfile respeitado.
- ✅ **Typecheck:** `bun x tsc --noEmit` = EXIT 0, TypeScript strict limpo (falha do wrapper `bunx` é ruído de ambiente Windows, não de código).
- ⚠️ **Testes:** 651/655 passam **sem login**. As 4 falhas têm causa raiz única — dependência `electron` ausente (workspace `launcher/` não instalado), não é defeito de lógica; resolvível instalando deps do launcher.
- ⏸️ **Smokes ao vivo (codex/live):** exigem sessão ChatGPT autenticada = **AUTH_REQUIRED, deferido para Fase 2** (não executados; nenhum cookie/segredo tocado).

Ou seja: a base compila, instala e passa a esmagadora maioria dos testes de forma totalmente isolada e sem login. O que resta (testes de host Electron do launcher + smokes ao vivo) depende, respectivamente, de instalar o workspace `launcher/` e de login humano — ambos fora do escopo baseline e registrados como pendências honestas.

### Pendências honestas

1. Instalar deps do sub-workspace `launcher/` (`bun install` dentro de `launcher/`) para destravar os 4 testes de integração Electron. Custo: download do Electron.
2. Smokes `smoke:codex` / `smoke:subagents:live` etc. exigem login ChatGPT — Fase 2.
3. `bun run build` (bundle de runtime) não foi executado; `smoke` depende de `dist/runtime`. Não avaliado neste baseline.
4. Shim `bunx` quebrado no Windows: usar `bun x` em vez de `bunx` nos scripts, ou reparar o shim npm global (fora do escopo/repo).
