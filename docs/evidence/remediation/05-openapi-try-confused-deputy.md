# Finding #5 — OpenAPI "Try It" confused deputy

- **Severidade:** high · **CWE-441/918/284** · confused-deputy
- **Arquivo:** `src/app/api/openapi/try/route.ts`

## Causa raiz
O proxy aceitava qualquer caminho sob `/api/`, todos os métodos mutáveis, fazia self-fetch
same-origin e encaminhava o cookie de sessão implicitamente. Como o self-fetch chega pela
identidade/localidade do próprio servidor (loopback), ele satisfazia controles LOCAL_ONLY e
alcançava rotas host-sensitive sob a credencial do servidor.

## Correção (causa raiz)
- **Bloqueia destinos LOCAL_ONLY e ALWAYS_PROTECTED** (todos os métodos) via
  `isLocalOnlyPath`/`isAlwaysProtectedPath` do routeGuard → 403.
- **Métodos mutáveis (POST/PUT/PATCH/DELETE) só nas superfícies de inferência/agent**
  (`/v1/`, `/v1beta/`, `/a2a`, `/.well-known/`); no `/api/` de gestão o proxy é GET/HEAD → 405.
- **Remove o encaminhamento implícito do cookie de sessão** — credenciais só se o chamador
  passá-las explicitamente (ex.: Authorization). O `buildForwardHeaders` já remove Cookie/Host.
- Mantém a restrição same-origin.

## Testes — `tests/unit/api/openapi-try-confused-deputy.test.ts`
- LOCAL_ONLY (`/api/mcp/*`, `/api/services/*`) → 403.
- ALWAYS_PROTECTED (`/api/shutdown`) → 403.
- método mutável no `/api/` → 405; no `/v1/*` → passa os gates.
- **cookie de sessão não é encaminhado**: servidor echo local confirma que o self-fetch não
  recebeu Cookie mesmo com a requisição de entrada carregando `session=…`.

## Resultado (evidência real)
- `node --test`: **6/6 pass, 0 fail**.
- `tsc --noEmit` (core): 0 erros nos arquivos tocados.
- `eslint` (com suppressions): exit 0.
