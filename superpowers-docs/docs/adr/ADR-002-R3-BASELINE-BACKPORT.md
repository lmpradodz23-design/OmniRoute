# ADR-002 — R3: baseline verde `c0b2253` + backport auditado do codex-chatgpt-web v4.0.7

- **Status:** **APROVADO PARA IMPLEMENTAÇÃO CONTROLADA** (na worktree isolada
  `repos/OmniRoute-r3-c0b2253`). Gate geral **NO-GO** e Fase 1 **bloqueada** até a validação final.
- **Data:** 2026-09-07 (atualizado).
- **Decisão:** usar `c0b2253f21c2e70c5d73581ae1be6f60a4ac5647` (main, v3.8.50, CI oficial verde,
  run 33819289311) como baseline e **portar SOMENTE** a integração auditada do
  codex-chatgpt-web **v4.0.7** (`b59d7dc51b84fb1f465ff1d00f5207f3b2b4a494`) + contratos
  `/v1/messages` e `/v1/responses`, **sem** mesclar `release/v3.8.51` e **sem** importar os
  ~3712 commits divergentes.
- **Preparação isolada:** worktree/branch `r3-backport-base` em `repos/OmniRoute-r3-c0b2253`,
  criada exatamente em `c0b2253` (checkout de `f9a1cc8` intacto). **Nenhum arquivo copiado.**

## 1. Contexto (por que R3)

- `c0b2253` **não contém** o vendor v4.0.7; carrega a integração antiga **v0.1.16** (commit
  `55592fca0ba19a27f1b769cec8fff61ff340a785`).
- A `release/v3.8.51` (f9a1cc8) está **sistemicamente vermelha** (CI, Docker amd64/arm64,
  nightlies) — inclusive no upstream. `c0b2253` é o único **oficialmente verde**.
- R3 = pegar o baseline verde e trazer **apenas** a integração v4.0.7 necessária.

## 2. Inventário Git reproduzível (`git diff --name-status c0b2253 f9a1cc8 -- <path>`)

> Reproduzível: `git -C repos/OmniRoute diff --name-status c0b2253f21c2 f9a1cc8a9b73 -- <path>`

| Categoria           | Paths                                                                |      A |      M |     D | Notas                                                 |
| ------------------- | -------------------------------------------------------------------- | -----: | -----: | ----: | ----------------------------------------------------- |
| **Vendor**          | `open-sse/vendor/codex-chatgpt-web/`                                 | **18** | **28** | **1** | 29 → 46 arquivos (blobs)                              |
| **Executores**      | `open-sse/executors/chatgpt-web*`                                    |      0 |      6 |     3 | v4.0.7 **consolidou** (13→9): reconciliar, não copiar |
| **Providers**       | `open-sse/config/providers/registry/chatgpt-web{,-codex}`            |      0 |      2 |     0 | modificar                                             |
| **Rotas**           | `src/app/api/v1/{messages,responses}`, `internal/codex-responses-ws` |      0 |      3 |     0 | contratos existem em ambos; **alinhar**               |
| **Banco/migrações** | `src/lib/db/migrations/`                                             |      2 |      0 |     0 | **somente 168 e 171** (ver §3)                        |
| **Testes**          | `tests/**` (chatgpt-web/codex)                                       |     20 |     14 |    10 | padrão "cleanroom" v4.0.7 — **não pular testes**      |
| **Docs**            | `docs/**`, `changelog.d/**` (chatgpt-web/codex)                      |      6 |      0 |     0 | changelog/entries                                     |
| **Dependências**    | `package.json`                                                       |      — |      1 |     — | ver §4                                                |

**Correção do documento anterior:** vendor é **29 → 46** (não 35/51); diff exato **18 A / 28 M /
1 D**. A estimativa "80–120 arquivos" é substituída por este inventário reproduzível (~114
arquivos somando as categorias).

## 3. Grafo de migrações e dependência real (item corrigido)

Migrações presentes em f9a1cc8 e ausentes em c0b2253 (163→173): **164–173**. Apenas duas tocam
chatgpt-web (grep no conteúdo por `chatgpt|codex|cleanroom`):

```
168_retire_chatgpt_web.sql            (cria triggers de retirada de chatgpt-web/cgpt-web)
        │  (dependência comprovada)
        ▼
171_restore_chatgpt_web_cleanroom.sql (DROP dos triggers de 168; habilita o provider cleanroom)
```

- **Prova (conteúdo de 171):** _"Migration 168 intentionally retired both `chatgpt-web` and its
  legacy `cgpt-web` alias … this migration only relaxes the durable triggers …"_ e executa
  `DROP TRIGGER IF EXISTS provider_connections_retire_chatgpt_web_*`.
- **Não são dependência da integração:** 164 (retire microsoft designer), 165 (felo), 166 (gpl),
  167 (qwen), 169 (model_capabilities), 170 (log export), 172 (quota reset), 173 (call_logs video).
  → **A migração 171 NÃO é "dependência dura" isolada;** o par **168→171** é o necessário, na ordem.

## 4. Dependências (classificação comprovada por código)

- **Dependências do codex-chatgpt-web v4.0.7 (exigidas pela integração):**
  - `bun` **1.4.0** (`devDependencies`) — runtime do módulo.
  - `playwright` / `playwright-core` **1.62.1** (`dependencies`) — automação de browser do ChatGPT Web.
- **Dependência dos web-providers do OmniRoute (SEPARADA):**
  - **`tls-client-node`** — **ausente do `package.json`** (binário nativo baixado no install);
    referenciado por `open-sse/executors/{claude-web,grok-web,lmarena,notion-web,perplexity-web}`
    e testes `*TlsClient.test.ts`. **Não é dependência do vendor codex-chatgpt-web.** Relevante
    para a falha do Vitest UI (§6 da proposta), tratada por verificação controlada.

## 5. Banco — MIGRAÇÃO ÚNICA DE CONVERGÊNCIA (item 3/4 — revisado)

**Decisão (não transplantar 168 e 171 literalmente):** em vez de portar duas migrações, criar
**UMA única migração de convergência** com **número novo ≥174**, que produz **diretamente** o
**estado final cleanroom** do provider chatgpt-web, e que é **idempotente/aditiva/transacional**,
convergindo tanto de um banco novo (nível 163) quanto de um banco existente (nível 173).

- **Requisitos da migração de convergência:**
  - **Aditiva** — só cria/relaxa o necessário para o provider cleanroom; **não remove dados**,
    **não reseta**, **não renumera**, **não faz downgrade**.
  - **Transacional** — tudo dentro de uma transação; falha → rollback limpo.
  - **Idempotente** — `IF EXISTS`/`IF NOT EXISTS` e checagem de estado: reexecução não altera nada.
  - **Número ≥174** — acima do maior número das duas linhas, sem colidir com 164–173.
- **(P1) Banco NOVO (nível 163, base c0b2253):** a migração leva o schema do provider antigo
  (v0.1.16) ao estado cleanroom final, **sem** aplicar 164–173 (não pertencem à integração).
- **(P2) Banco EXISTENTE (nível 173, linha release):** já tem 168+171 aplicadas; a migração de
  convergência **detecta o estado cleanroom já presente e é no-op** (idempotência), sem
  reaplicar/renumerar/reverter. O runner nunca reaplica por número já registrado.
- **Derivação:** a lógica final da migração é **derivada** do efeito combinado de 168+171
  (retirar triggers legados + habilitar writes canônicos) — **sem copiar 168/171 como arquivos**.
- **Validação obrigatória:** provar P1 e P2 por **hash do schema** e **leitura real dos dados**,
  além de **repetição** (rodar 2×), **backup e restore**, usando as cópias anonimizadas nos
  níveis 163 e 173 (§6-preparação). Migração nunca destrutiva.

## 6. Rollback, compatibilidade de dados e regra de atualização futura (item 7)

- **Rollback por etapa:** cada commit do backport é pequeno e revertível (`git revert`), na
  branch `r3-backport-base`; o baseline `c0b2253` permanece intacto como ponto de retorno.
- **Rollback de banco:** como não há downgrade destrutivo, reverter o código não exige reverter
  schema; migrações ≥174 permanecem aditivas e inertes se o provider for desabilitado.
- **Compatibilidade de dados:** o provider cleanroom **mantém desabilitadas** as linhas antigas
  até um operador fornecer a nova storage-state credential (conforme 171). Sem reuso de
  credencial/fonte da integração antiga.
- **Regra de atualização futura:** atualizações do codex-chatgpt-web (v4.0.7 → futuras) repetem
  o ciclo auditado (vendor + executores + rotas + migrações ≥ maior número + testes), sempre
  aditivo, com ADR e CI verde nos jobs confiáveis + verificação controlada de Build/Vitest.

## 7. Sequência de implementação (quando autorizada — commits pequenos)

1. `deps`: alinhar bun/playwright(-core) no `c0b2253` (sem quebrar o build).
2. `vendor`: 18 A / 28 M / 1 D do `open-sse/vendor/codex-chatgpt-web/`.
3. `executores`: reconciliar 13→9 (6 M / 3 D).
4. `providers` + `rotas`: 2 M + 3 M (alinhar contratos `/v1/messages`, `/v1/responses`).
5. `db`: **uma** migração de convergência ≥174 (idempotente/aditiva/transacional; P1/P2), sem
   transplantar 168/171 (§5).
6. `testes`: 20 A / 14 M / 10 D (não alterar expectativas; portar como estão).
7. `docs`: 6 A (changelog).
   Cada etapa: instalação limpa + secret scan + rollback + os gates confiáveis (lint, integração,
   8/8 shards) + verificação controlada de Build/Vitest.

## 8. Consequências

- Base verde real; escopo fechado (~114 arquivos, ~7 commits); risco médio (reconciliar
  reestrutura de executores + migrações + conflitos pontuais onde v4.0.7 referencia utilitários
  ausentes em c0b2253).
- Preserva vendor **v4.0.7** e APIs `/v1/messages` + `/v1/responses`. Upstream intocado.
