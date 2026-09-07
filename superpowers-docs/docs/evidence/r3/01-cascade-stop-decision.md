# R3 — Etapa 4 (executores): condição de PARADA por cascata de dependências

> Registro obrigatório de decisão (stop-condition da missão autônoma).
> Worktree `repos/OmniRoute-r3-c0b2253` @ `15b3e22f6` (baseline+deps+vendor) — **limpa**.
> Gate Fase 0 permanece **NO-GO**; Fase 1 bloqueada. Nenhum estado verde artificial produzido.

## 1. O que foi tentado (etapa 4 do ADR-002 §7)

Reconciliar os executores chatgpt-web (0A/6M/3D) do baseline verde `c0b2253` para a
integração v4.0.7 (`f9a1cc8`), portando:

- 6 M: `chatgpt-web-codex.ts`, `chatgpt-web-codex/{doctor,models,storageState,tunnelClient}.ts`, `chatgpt-web.ts`
- 3 D: `chatgpt-web/{citations,handoff,models}.ts`
- 2 A utilitários de apoio: `open-sse/utils/codexPublicError.ts`, `open-sse/utils/chatgptWebExecutorAdapter.ts`
- +dep `tiktoken` (optional)

## 2. O que a compilação revelou (medição real)

`tsc --noEmit -p open-sse/tsconfig.json` subiu de **11 → 18 erros** após o port dos
executores. Os erros novos **não** se resolvem dentro do inventário R3: os executores
v4.0.7 importam módulos que **não existem** em `c0b2253` e que pertencem à linha
`release/v3.8.51`.

### Módulos exigidos pelos executores v4.0.7 e AUSENTES em c0b2253 (novos = A)

Reproduzível: `git -C repos/OmniRoute diff --name-status c0b2253f21c2 f9a1cc8a9b73 -- <path>`

```
A  open-sse/utils/chatgptWebAttachments.ts
A  open-sse/utils/chatgptWebBrowserSession.ts
A  src/shared/constants/chatgptWebCodex.ts
```

### Acoplamento a serviço COMPARTILHADO (fora do vendor, modificado na release)

```
M  open-sse/services/browserPool.ts
M  packages/browser-pool/src/services/browserPool.ts
```

`browserPool` é infraestrutura compartilhada por múltiplos web-providers, **não** é do
vendor codex-chatgpt-web. Portá-lo altera comportamento fora do escopo do backport.

## 3. Dimensão da cascata (medição reproduzível)

```
git -C repos/OmniRoute diff --name-only c0b2253f21c2 f9a1cc8a9b73 | grep -iE 'chatgpt-web|codex' | wc -l
→ 128 arquivos
```

Removendo as categorias previstas no inventário R3 (vendor, executors, providers,
rotas v1, tests, docs, changelog, migrations), **ainda restam 20 arquivos fora do
inventário**, incluindo utilitários compartilhados, validação de provider, rotas de
imagem, OAuth do codex, dashboard e Dockerfile:

```
bin/chatgpt-web-codex-mcp.mjs
docker/chatgpt-web-codex-browser/Dockerfile
open-sse/config/codexIdentity.ts
open-sse/config/providers/registry/codex/index.ts
open-sse/executors/codex.ts
open-sse/executors/codex/tools.ts
open-sse/services/combo/nativeCodexTurnPin.ts
open-sse/services/compression/engines/codexResponses/index.ts
open-sse/utils/codexPublicError.ts
src/app/(dashboard)/dashboard/cli-code/components/CodexToolCard.tsx
src/app/(dashboard)/dashboard/usage/components/ProviderLimits/useCodexResetCreditRedemption.ts
src/app/api/cli-tools/codex-settings/route.ts
src/app/api/oauth/codex/import/route.ts
src/app/api/v1/chatgpt-web/image/[id]/route.ts
src/lib/oauth/services/codexImport.ts
src/lib/oauth/utils/codexAuthFile.ts
src/lib/oauth/utils/codexAuthImport.ts
src/lib/providers/validation/chatgptWebCodex.ts
src/lib/usage/codexResetCredits.ts
src/shared/constants/chatgptWebCodex.ts
```

## 4. Por que isso aciona PARADA (stop-conditions da missão)

A integração v4.0.7 dos executores está **profundamente acoplada** a mudanças da
linha de release (novos utils `chatgptWeb*`, constantes compartilhadas, serviço
`browserPool` compartilhado, OAuth/validação/imagem do codex). Portar os executores
**puxa** essas dependências, o que:

- **Faz surgir dependência inesperada da `release/v3.8.51`** (browserPool compartilhado,
  utils/constantes novos) — condição de parada explícita. **Esta é a razão válida da parada.**
- **Correção de contagem (não foi estouro de >20%):** o inventário R3 previa ~114 arquivos;
  o acoplamento chatgpt-web/codex real é **128 arquivos** → crescimento de ~**12,3%**, **abaixo**
  do teto de 20%. Portanto o gatilho **não** foi "escopo >20%"; foi a **natureza** da dependência
  (serviço compartilhado + módulos exclusivos da release), não o volume. O padrão de cascata
  (11→18 erros) indica _tendência_ de crescimento, a ser controlada por teto rígido na R3-A.
- **Tende a exigir trazer partes da release** para o provider funcionar de fato — a R3-A
  passa a permitir isso de forma **auditada e com teto** (ver §7), sem mesclar a release inteira.

## 5. Estado preservado (nada verde artificial)

- Worktree limpa em `15b3e22f6`. Etapas **1 (baseline)**, **2 (deps `2cabab94e`)** e
  **3 (vendor `15b3e22f6`)** permanecem **válidas e revertíveis** por `git revert`.
- O experimento de executores foi **descartado** (não commitado): `tsc` tinha 18 erros;
  commitá-lo seria registrar estado quebrado como "verificável" — proibido pela missão.
- Baseline `c0b2253` intacto como ponto de retorno. Upstream intocado. Sem force-push.

## 6. Decisão a apresentar ao aprovador (mudança de escopo — humano decide)

A R3 "cirúrgica" (vendor + executores sem tocar a release) **não é alcançável** para a
camada de executores: o provider v4.0.7 depende de infraestrutura compartilhada e de
módulos que só existem na release. Opções (nenhuma executada sem aprovação):

- **R3-A (escopo ampliado, ainda auditado):** trazer também o conjunto mínimo comprovado
  por compilação — `browserPool` (compartilhado), `chatgptWebAttachments`,
  `chatgptWebBrowserSession`, `shared/constants/chatgptWebCodex` e o que o `tsc` exigir —
  cada arquivo auditado, com nota de que passa a alterar serviço compartilhado. Risco:
  a cascata pode continuar; medir a cada arquivo e reparar se ultrapassar novo teto.
- **R3-B (só contratos, sem provider real):** portar apenas as rotas `/v1/messages` e
  `/v1/responses` + registrar o provider chatgpt-web como **desabilitado** (feature flag
  off, estado cleanroom via migração ≥174), sem os executores v4.0.7. Entrega os
  contratos pedidos sobre base verde; o provider real fica para uma iteração futura.
- **R3-C (rebaseline para a release e estabilizar):** abandonar o backport cirúrgico e
  trabalhar sobre `release/v3.8.51`, assumindo o custo de estabilizar a suíte vermelha.
  Contraria a premissa "base oficialmente verde".

## 7. DECISÃO DO APROVADOR: R3-A (escopo ampliado auditado) — 2026-09-07

O aprovador escolheu **R3-A**: o resultado final precisa ter o provider ChatGPT Web
**realmente funcional**. R3-B é rejeitada como conclusão (rotas com provider permanentemente
desabilitado = entrega incompleta); só existe como **fallback temporário de desenvolvimento**
(proteção por feature flag durante os commits intermediários), nunca como definição de pronto.
R3-C rejeitada (release permanece vermelha).

### Condições vinculantes da R3-A

- **Teto rígido: 150 arquivos únicos alterados.** PARAR de novo se: ultrapassar 150; surgir
  nova dependência de **auth/OAuth/créditos/dashboard/banco central**; for necessário importar
  um **subsistema inteiro** da release; **testes de outro provider regredirem**; ou aparecer
  **risco de segurança/perda de dados**.
- **Grafo de dependências alcançáveis** a partir dos executores chatgpt-web v4.0.7 (import real,
  não grep por "codex"). Portar **somente** o que é alcançável pelo fluxo real do ChatGPT Web.
- **Auditoria por arquivo** antes de portar: por que é necessário; imports adicionais;
  consumidores existentes; impacto sobre outros providers; segurança; teste; rollback.
- **browserPool é compartilhado** → regressão obrigatória dos demais web-providers que o usam
  (claude-web, grok-web, perplexity-web, lmarena, notion-web, …). Não consertar ChatGPT Web
  quebrando outros consumidores.
- **`tsc` só como diagnóstico de delta** (baseline já tem 11 erros no comando direto). Gate
  autoritativo = scripts oficiais do repo + prova de **zero erros novos**.
- **Commits separados:** grafo/ADR · utils+constantes · browserPool · executores ·
  providers/rotas · migração · testes · docs.
- **Marco 1** (após utils+browserPool+executores): instalação limpa + lint/typecheck oficiais +
  testes dos web-providers + integração + secret scan.
- **Gate final** (antes do GO): provider habilitado em ambiente controlado provando login,
  storage seguro de sessão, `/v1/messages`, `/v1/responses`, streaming, uso de ferramentas,
  retomada, erros/timeouts, redação de credenciais, reinício sem processo órfão.
- Gate geral permanece **NO-GO** e a **Fase 1 bloqueada** até toda a R3-A ficar verde.

### Conjunto direto inicial (5 arquivos comprovados pelo tsc)

```
open-sse/utils/chatgptWebAttachments.ts          (A — novo)
open-sse/utils/chatgptWebBrowserSession.ts       (A — novo)
src/shared/constants/chatgptWebCodex.ts          (A — novo)
open-sse/services/browserPool.ts                 (M — compartilhado)
packages/browser-pool/src/services/browserPool.ts(M — compartilhado)
```

O grafo de alcançabilidade (item 3) define o restante; nada portado em massa.
