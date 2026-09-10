# Finding #4 — `mcp:connect` usa ferramentas de escrita sem escopos (default-off)

- **Severidade:** high · **CWE-862/269** · missing-authorization
- **Arquivos:** `open-sse/mcp-server/server.ts`, `open-sse/mcp-server/scopeEnforcement.ts`, `docs/frameworks/MCP-SERVER.md`

## Causa raiz
`evaluateToolScopes` já é fail-closed (nega ferramenta sem definição e nega escopo ausente)
**quando** `enforceScopes=true`. Mas `server.ts` ligava o enforcement apenas se a env fosse
exatamente `"true"` (`=== "true"`), i.e. **default OFF**: com a variável ausente, uma chave
`mcp:connect` (só transporte) alcançava qualquer ferramenta `write:*`. A doc canônica
(`docs/reference/ENVIRONMENT.md`) já dizia `true`, contradizendo o código.

## Correção (causa raiz)
- Novo helper testável `isMcpScopeEnforcementEnabled()` em `scopeEnforcement.ts`: **default ON**;
  só desliga com valor explícito `false/0/no/off` (escape hatch de migração legado).
- `server.ts` passa a usar o helper (`const MCP_ENFORCE_SCOPES = isMcpScopeEnforcementEnabled()`).
- Doc `MCP-SERVER.md` corrigida para `true` (default on), alinhando com `ENVIRONMENT.md`.

Com isso: `mcp:connect` abre só o transporte; ferramenta sem escopo declarado → negada;
`write:*/execute:*/admin:*` exigem escopo concedido.

## Testes — `tests/unit/mcp-scope-enforcement-default.test.ts`
- default ON para unset/""/"true"/"1"/outros; opt-out só para false/0/no/off.
- `mcp:connect`-only → negado para `write:combos` (missing_scopes).
- ferramenta sem definição → negada (tool_definition_missing).
- caller com o escopo → permitido; wildcard `write:*` satisfaz.

## Resultado (evidência real)
- `node --test` (arquivo novo): **6/6**.
- Regressão MCP: **70/70** (mcp-connect-scope, tool-collections, model-catalog, local-corpus,
  notion, obsidian, extra-forward, pool-tools, tool-count) — nenhuma quebra pelo flip do default.
- `tsc --noEmit` (open-sse): 0 erros nos arquivos; `eslint` (com suppressions): exit 0.

## Pendência (Fase 3)
Gate de CI proibindo ferramenta MCP sem escopos declarados + matriz chave×tool automatizada.
