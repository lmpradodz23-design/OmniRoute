# R3-A — Grafo de dependências alcançáveis dos executores chatgpt-web v4.0.7

> Item 3 das condições R3-A. Método: resolução **estática de imports reais** (não grep),
> partindo dos executores em `f9a1cc8`, seguindo imports relativos + aliases
> (`@/`, `@omniroute/open-sse`, `@omniroute/browser-pool`), ignorando pacotes npm.
> Script: `scratchpad/reach.cjs` (reprodutível). Cruzado com `git diff c0b2253 f9a1cc8`.

## 1. Pontos de entrada (executores em f9a1cc8)

```
open-sse/executors/chatgpt-web.ts
open-sse/executors/chatgpt-web-codex.ts
open-sse/executors/chatgpt-web-codex/{credentials,doctor,models,runtime,storageState,tunnelClient}.ts
```

## 2. Resultado (reprodutível)

- **Fecho transitivo alcançável:** **1177** arquivos internos (0 imports internos não resolvidos).
- **Alcançável ∩ difere de `c0b2253` = 376** arquivos. **Este é o LIMITE SUPERIOR** do que
  _poderia_ precisar de port — **não** o conjunto obrigatório: a maioria difere por evolução
  geral do repositório (novos providers `adobeFirefly*`, `maxai`, `oneminai`, `seekai`, `uc`;
  reescritas de `combo`/`autoCombo`/`compression`; camada `db`; `pricing`) **sem relação com
  chatgpt-web**. Nesses casos **mantemos a versão de `c0b2253`**.

### Classificação dos 376

| Classe                                                                                                        |                Qtd | Ação                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | -----------------: | -------------------------------------------------------------------------------------------- |
| chatgpt-web/codex-específicos (alvo real)                                                                     |             **69** | portar — mas **46 são vendor já portado** (etapa 3, `15b3e22f6`) → restam **~23 não-vendor** |
| núcleo genérico (não chatgpt/codex), difere por evolução                                                      | 307 (58 A / 249 M) | **NÃO** portar preventivamente; só se o `tsc` provar símbolo novo exigido                    |
| — dentro do núcleo: DANGER (base.ts, `combo/`, `src/lib/db/` central, `sse/services/auth`, `oauth/constants`) |                 59 | se exigidos → **stop-trigger** (subsistema inteiro/banco central/auth)                       |

### Exclusões corretas (falsos-positivos do grep anterior)

O fluxo real **não alcança** `dashboard/**`, rotas `api/oauth/codex/import`, `codexImport`,
`codexResetCredits`, Dockerfile, etc. Os "20 fora do inventário" do doc 01 incluíam esses
falsos-positivos; o grafo os descarta. Alvo real de OAuth/créditos/dashboard = **zero**.

## 3. Alvo real não-vendor a portar (chatgpt-web/codex, fora do vendor já feito)

Novos (A):

```
open-sse/utils/chatgptWebAttachments.ts        open-sse/utils/chatgptWebBrowserSession.ts
open-sse/utils/chatgptWebDeltaV1.ts            open-sse/utils/chatgptWebExecutorAdapter.ts
open-sse/utils/chatgptWebFirstParty.ts         open-sse/utils/chatgptWebTransport.ts
open-sse/utils/codexPublicError.ts             src/lib/providers/validation/chatgptWeb.ts
src/shared/constants/chatgptWebCodex.ts        src/shared/constants/chatgptWebRetirement.ts
```

Modificados (M):

```
open-sse/config/codexIdentity.ts
open-sse/config/providers/registry/{chatgpt-web,chatgpt-web-codex,codex}/index.ts
open-sse/executors/chatgpt-web.ts  open-sse/executors/chatgpt-web-codex.ts
open-sse/executors/chatgpt-web-codex/{doctor,models,storageState,tunnelClient}.ts
open-sse/executors/codex.ts        open-sse/executors/codex/tools.ts
open-sse/services/combo/nativeCodexTurnPin.ts
open-sse/services/compression/engines/codexResponses/index.ts
```

Compartilhado (M, fora do nome mas exigido pelo tsc): `open-sse/services/browserPool.ts`,
`packages/browser-pool/src/services/browserPool.ts`.

## 4. Plano de execução R3-A (delta-driven, com teto)

1. Portar o **conjunto direto** (5 arquivos nomeados) + os utils/constantes chatgpt-web
   acima, **um de cada vez, auditando** (por quê / imports / consumidores / impacto em outros
   providers / segurança / teste / rollback).
2. Após cada lote, rodar **typecheck oficial** e medir o **delta**: portar só o arquivo que
   fornece o símbolo novo faltante — **preferencialmente do alvo real**; se o delta exigir um
   arquivo do **núcleo DANGER** (base.ts/combo/db/auth/oauth), **PARAR** e reavaliar (stop-trigger).
3. **Teto rígido: 150 arquivos únicos** no total da R3-A (vendor 46 já conta). Orçamento
   restante após vendor+alvo(~23) ≈ **80** para o que o tsc comprovar do núcleo.
4. `browserPool` compartilhado → **regressão obrigatória** de claude-web, grok-web,
   perplexity-web, lmarena, notion-web e demais consumidores.
5. Provider sob **feature flag OFF** nos commits intermediários (proteção de dev, não entrega).

## 5. Leitura honesta do risco

O alvo real é pequeno (~23 não-vendor). O risco é o **núcleo**: se os executores/vendor v4.0.7
usarem símbolos novos de `base.ts` e do subsistema `combo`/`db`, o port pode encadear para os
59 arquivos DANGER e estourar o teto — o que **acionaria nova parada** sob as regras R3-A. A
compilação-delta é o árbitro. Nada é portado em massa; cada arquivo é comprovadamente exigido.
