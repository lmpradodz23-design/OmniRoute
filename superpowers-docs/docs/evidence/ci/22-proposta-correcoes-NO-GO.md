# Proposta de Correções (NO-GO mantido) — diagnóstico e planejamento

> **Somente diagnóstico/planejamento. Nada implementado.** Fase 1 bloqueada; gate NO-GO.
> Regras respeitadas: não alterar testes, não pular testes, não enfraquecer gates, preservar
> vendor codex-chatgpt-web **v4.0.7** e as APIs **/v1/messages** e **/v1/responses**.

## 1. Matriz de falhas (runs no fork, evento workflow_dispatch)

| Falha                                                                                                                                                        | f9a1cc8 (release) | d26fe038 (release, ancestral) | c0b2253 (main, CONTROLE) | Classe                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| Unit: `HuggingFace image model → 400 + hint (#6457)`                                                                                                         | ✖                 | (cluster)                     | ✓ passa                  | **bug real (linha release)**                                                            |
| Unit: `sanitizeErrorMessage ReDoS guard` (~3.7s)                                                                                                             | ✖                 | (cluster)                     | ✓                        | **timeout/perf**                                                                        |
| Unit: `sanitizeErrorMessage tunnel-leak` / `redaction layers stay in step`                                                                                   | ✖                 | (cluster)                     | ✓                        | **bug real / concorrência**                                                             |
| Unit: `guide-settings POST …` (x4, escreve config)                                                                                                           | ✖                 | (cluster)                     | ✓                        | **bug real (env/HOME)**                                                                 |
| Unit: `handleImageGeneration (codex)` (x3), `Kiro stream…`, `model sync route…`, `HuggingChat…` (x3), `persistAttemptLogs`, `the gate exits 0 (synced repo)` | ✖                 | (cluster)                     | ✓                        | **bug real (linha release)**                                                            |
| Integration Tests (1/2, 2/2)                                                                                                                                 | ✖                 | ✖                             | ✓ passa                  | **bug real (linha release)**                                                            |
| Lint: `check:agent-skills-sync` (exit 2, "Generated: 1")                                                                                                     | ✖                 | ✓                             | ✓                        | **arquivo gerado fora de sync**                                                         |
| Docs Sync (Strict)                                                                                                                                           | ✖                 | ✓                             | ✓                        | **doc gerado fora de sync**                                                             |
| Build (`npm run build`)                                                                                                                                      | cancelled         | cancelled                     | cancelled                | **config CI / ambiente** (timeout no runner do fork; upstream usa self-hosted c/ + RAM) |
| Vitest `test:vitest:ui` (1 test file)                                                                                                                        | ✖                 | ✖                             | ✖                        | **ambiente/CI** (`tls-client-node` nativo ausente sob install do fork)                  |
| Docker amd64/arm64 (upstream `Publish to Docker Hub`, release/v3.8.51)                                                                                       | failure           | —                             | —                        | **linha release vermelha no upstream**                                                  |

**Fato-chave:** todos os itens marcados "bug real (linha release)" **passam em `c0b2253` (main)**
e **falham em `f9a1cc8`/`d26fe038` (release)** → são **regressões/divergências específicas da
linha release/v3.8.51**, não do main. **Correção (item 1):** Build e Vitest **falharam nos três
SHAs testados no fork** (f9a1cc8, d26fe038 e c0b2253) — inclusive `c0b2253`, que é verde no
CI oficial do upstream. Não afirmamos "qualquer commit": foram os três SHAs medidos. Isso
aponta fortemente para **artefato de fork/infra**, a confirmar pelos testes controlados (§7/§8).

## 2. Root-cause dos itens de fork (Build e Vitest)

- **Build:** observado que o step `npm run build` termina como **`cancelled`** (não `failure`)
  nos três SHAs no fork; steps anteriores (checkout, setup-node, npm-ci-retry, check:node-runtime)
  = success. O job Build no upstream roda em **runner self-hosted** (ci.yml: "own-origin only;
  fallback ubuntu-latest", ".113's RAM") e é `success` para c0b2253.
  - **Correção (item 2):** a **falta de RAM/tempo no `ubuntu-latest` do fork é HIPÓTESE FORTE,
    não causa raiz confirmada.** O `cancelled` é consistente com timeout de job por lentidão do
    runner, mas pode haver outra causa (cancelamento por dependência, disco, etc.). **A confirmar
    pela execução controlada do §7** (medir RAM/duração num runner equivalente ao upstream).
  - _Correção (validação, se confirmado):_ rodar o Build num runner com RAM adequada; não é fix de produto.
- **Vitest `test:vitest:ui` (1 file):** log mostra `tls-client-node native binary missing
(blocked by --ignore-scripts or a failed fetch)`. O install do CI usa retry/cache que, no
  fork, não trouxe o binário nativo `tls-client-node` → 1 arquivo de teste UI falha. Verde no
  upstream. **Ambiente/CI**, não bug de produto.
  - _Correção (validação):_ garantir o binário `tls-client-node` no install do fork
    (foreground-scripts / rebuild), não é fix de produto.

## 3. Menor série de commits corretivos (proposta — por causa raiz)

> Estes commits seriam aplicados **numa branch de trabalho baseada num SHA da linha release**
> (não no frozen), cada um isolado por causa raiz. **Nada aqui altera testes.**

**C1 — Sincronizar artefatos gerados (lint + docs-sync).**

- Causa: `check:agent-skills-sync` gera 1 arquivo não commitado; Docs Sync (Strict) idem.
- Ação: rodar os geradores oficiais (`npm run check:agent-skills-sync`, gerador de docs) e
  commitar os arquivos regenerados.
- Arquivos: os artefatos gerados (skills/_, docs/_). Risco: **baixo**. Testes: Lint + Docs
  Sync ficam verdes. Rollback: reverter o commit. Upstream-PR: **sim** (drift trivial).

**C2 — Corrigir o teste de perf/timeout ReDoS sem alterar expectativa.**

- Causa: `sanitizeErrorMessage terminates on long adversarial input (ReDoS guard)` estoura o
  tempo em runners lentos (não é falha lógica; é o algoritmo demorando).
- Ação: root-cause do regex/algoritmo (backtracking) e otimizar a implementação de
  `sanitizeErrorMessage` para terminar em tempo linear — **corrige o produto, não o teste**.
- Arquivos: `open-sse/**/sanitize*`/`redact*`. Risco: **médio** (regex de segurança). Testes:
  o próprio teste ReDoS + testes de redação. Rollback: reverter. Upstream-PR: **sim** (é bug
  de ReDoS de segurança, GHSA-relevante).

**C3 — Corrigir a redação/tunnel-leak (`redaction layers stay in step`, `tunnel-leak intact`).**

- Causa: as duas camadas de redação divergem em certos shapes (possível regressão na linha release).
- Ação: root-cause da divergência entre as camadas e alinhar a implementação. **Não alterar o teste.**
- Arquivos: `open-sse/**/redact*`, `sanitize*`. Risco: **médio-alto** (segurança/PII). Testes:
  suíte de redação. Rollback: reverter. Upstream-PR: **sim**.

**C4 — Corrigir HuggingFace image / handleImageGeneration / model-sync / HuggingChat / Kiro.**

- Causa: cluster de provedores (respostas/erros tipados) regrediu na linha release.
- Ação: root-cause POR teste (ex.: `#6457` espera 400 + hint; verificar o handler de imagem
  HF). Provável correção pontual em cada handler de provedor. **Não alterar testes.**
- Arquivos: `open-sse/executors/**`, `src/app/api/v1/chat/completions/**`, handlers de provider.
  Risco: **médio**. Testes: os respectivos. Rollback: por commit. Upstream-PR: **sim**.

**C5 — Corrigir `guide-settings` (escrita de config) e `the gate exits 0 (synced repo)`.**

- Causa: testes que escrevem config dependem de HOME/ambiente; o "gate synced" checa árvore
  gerada. Podem ser env OU drift.
- Ação: root-cause; se drift → cai em C1; se env → tornar o código robusto ao HOME do runner
  (sem alterar o teste). Risco: **baixo-médio**. Upstream-PR: **sim**.

**C6 — Integration Tests (linha release).**

- Causa: integração falha na release (passa no main). Requer root-cause do(s) caso(s).
- Ação: investigar o diff release↔main na área de integração; corrigir a regressão de produto.
  Risco: **médio**. Upstream-PR: **sim**.

> **Build e Vitest não geram commit de produto** (são infra de CI/fork). Para validar o gate,
> ver §5.

## 4. Sobre o vendor e APIs

- Os commits C1–C6 (rota R2) **não tocam** `open-sse/vendor/codex-chatgpt-web/` nem as rotas
  `/v1/messages` e `/v1/responses`. Entre `d26fe038↔f9a1cc8` (linha release) essas áreas não mudaram.
- **Fato (item 3):** `c0b2253` (main) **NÃO contém o vendor v4.0.7**. Ele carrega uma
  **integração antiga do codex-chatgpt-web (versão 0.1.16, baseada no commit
  `55592fca0ba19a27f1b769cec8fff61ff340a785`)**. Corroboração estrutural: em `c0b2253`,
  `open-sse/vendor/codex-chatgpt-web/` tem **35 arquivos, SEM `version.ts`** e com layout antigo
  (tem `web-search/`, faltam `process.ts`, `launcher-browser-host.ts`, `chatgpt-web-models.ts` e
  os adapters novos). Em `f9a1cc8`, o mesmo vendor tem **51 arquivos** e `version.ts` =
  `v4.0.7 commit b59d7dc51b84fb1f465ff1d00f5207f3b2b4a494`.
- Portanto, adotar `c0b2253` **exige portar o vendor v4.0.7** (não está lá) — é o núcleo da R3 (§5).

## 5. Estratégia recomendada — **R3 (principal)**

A linha **release/v3.8.51 está sistemicamente vermelha até no upstream** (CI, Docker amd64/arm64,
nightlies). As rotas:

- **(R1)** Adotar `c0b2253` como está — **rejeitada**: ele tem a integração antiga v0.1.16 (§4),
  não o vendor v4.0.7 exigido.
- **(R2)** Consertar a linha release (C1–C6) — **rejeitada como principal**: consertar um upstream
  sistemicamente vermelho; esforço alto e aberto.
- **(R3) RECOMENDADA:** usar **`c0b2253` como baseline verde** e **portar SOMENTE a integração
  auditada necessária do codex-chatgpt-web v4.0.7** (vendor `b59d7dc5`) + contratos `/v1/messages`
  e `/v1/responses`, **sem** mesclar a release/v3.8.51 e **sem** importar os milhares de commits
  divergentes.

> **Inventário exato, grafo de migrações, dois caminhos de banco, deps e rollback estão no
> `docs/adr/ADR-002-R3-BASELINE-BACKPORT.md`** (autoritativo, reproduzível por `git diff
--name-status`). Resumo corrigido abaixo.

### 5.1 Diff exato do vendor (item 4 — CORRIGIDO)

`open-sse/vendor/codex-chatgpt-web/`: **c0b2253 = 29 arquivos → f9a1cc8/v4.0.7 = 46 arquivos**
(blobs). Diff Git exato: **18 A · 28 M · 1 D · 0 R** (a contagem anterior 35/51 e "~33
modificados" estava errada — contava entradas de diretório da API de trees).

Superfície fora do vendor (name-status): **executores** 0A/6M/3D (13→9, **reconciliar**),
**providers** 0A/2M/0D, **rotas** (`/v1/messages`, `/v1/responses`, `codex-responses-ws`)
0A/3M/0D. **Testes** 20A/14M/10D. **Docs** 6A.

### 5.2 Migrações / dependências (item 5 — CORRIGIDO)

- **Migrações — NÃO é "dependência dura" isolada da 171.** Das 164–173 (ausentes em c0b2253),
  **apenas 168 e 171 tocam chatgpt-web**; as demais são de outros provedores/temas (retire
  microsoft/felo/qwen, gpl, model_capabilities, log export, quota, call_logs). Prova: o conteúdo
  de **171 depende de 168** (faz `DROP TRIGGER ...retire_chatgpt_web...` criados por 168). Logo o
  necessário é o **par 168→171**, na ordem — não 171 sozinha nem todas as 164–173.
- **Dependências (classificação por código):**
  - **codex-chatgpt-web v4.0.7:** `bun 1.4.0` (devDep) + `playwright`/`playwright-core 1.62.1` (dep).
  - **`tls-client-node`: dependência SEPARADA dos web-providers do OmniRoute** (claude-web,
    grok-web, lmarena, notion-web, perplexity-web) — **ausente do `package.json`** (binário nativo
    baixado no install). **Não é dep do vendor codex-chatgpt-web.**
- **Contratos** `/v1/messages` e `/v1/responses`: preservados; validar por testes de contrato.
- **Conflitos** onde v4.0.7 referencia utilitários da linha release ausentes em c0b2253 → commit
  pequeno de compatibilidade por conflito.

### 5.3 R3 × R2 (item 6)

| Critério                 | **R3 (backport v4.0.7 → c0b2253 verde)**                                                                                                                   | R2 (consertar release/v3.8.51)                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Arquivos                 | escopo **fechado ~114** (inventário Git reproduzível — ADR-002): vendor 47 (18A/28M/1D) + exec 9 + prov 2 + rotas 3 + migr 2 + testes 44 + docs 6 + deps 1 | aberto (≥ os ~26 testes + integração + drift; linha sistemicamente vermelha) |
| Commits                  | série pequena por área (vendor, executores, providers, rotas, migrações, deps) ~**6–10**                                                                   | C1–C6+ (aberto)                                                              |
| Risco                    | **médio** (base verde; reconciliar reestrutura + migrações + conflitos pontuais)                                                                           | **alto** (perseguir upstream vermelho; Docker/nightlies também falham)       |
| Manutenção futura        | **melhor** (base verde + só a integração necessária)                                                                                                       | pior (fork sobre release quebrada)                                           |
| Contribuição ao upstream | **baixa** (upstream já tem v4.0.7 na release; é backport p/ main)                                                                                          | possível, mas o upstream não mantém a release verde                          |

**Conclusão:** R3 é a de **menor risco e escopo fechado** para um gate verde real, preservando
vendor v4.0.7 + APIs. É a recomendação principal.

## 6. Verificação controlada de Build e Vitest (itens 7 e 8 — especificação, não executada)

- **Build (item 7):** rodar `npm run build` em **runner equivalente ao upstream** (self-hosted
  com a RAM do `.113`, ou um GitHub larger-runner ≥16 GB), com `/usr/bin/time -v` capturando
  **Max RSS** e **duração**, e o timeout do job elevado. Critério: se o build **conclui** e o
  pico de RAM/ tempo explicam o `cancelled` anterior → confirma a hipótese de infra. Registrar
  memória e duração como evidência.
- **Vitest (item 8):** restaurar `tls-client-node` **somente pelo mecanismo oficial** do projeto
  (reinstalar com scripts/foreground, sem `--ignore-scripts`), **verificar origem e integridade**
  do binário (checksum/assinatura do pacote publicado), e **repetir** `npm run test:vitest:ui`.
  Critério: com o binário íntegro presente, o arquivo de teste UI deve passar (como no upstream).

## 7. Estado

- **Gate: NO-GO** (permanece até R3 aprovada, implementada em commits pequenos, e passar
  instalação limpa, secret scan, lint, build, Vitest, integração e **8/8 shards**).
- Fase 1 **bloqueada**. **Nada implementado.** Upstream intocado. Vendor v4.0.7 e APIs
  `/v1/messages`+`/v1/responses` preservados. **Nenhum teste alterado, nenhum gate reduzido.**
