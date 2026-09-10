# Gate final — Harness de smoke autenticado (`/v1/models`, `/v1/messages`, `/v1/responses`)

O gate final da missão exige smoke autenticado dos endpoints públicos. Como isso precisa de uma
**instância rodando** + **credencial** e as chamadas de geração são **pagas**, o harness fica
PRONTO e é executado pelo operador (o executor não faz chamada paga nem usa credencial real sem
autorização).

## Arquivo
`scripts/smoke/authenticated-smoke.mjs` — Node ESM puro (sem dependências).

## O que verifica
| Passo | Endpoint | Esperado | Custo |
| --- | --- | --- | --- |
| 1 | `GET /v1/models` (auth) | 200 + `{ data: [...] }` | livre (roteamento + aceite da chave) |
| 2 | `GET /v1/models` (chave inválida) | 401/403 | livre (auth negativa) |
| 3 | `POST /v1/messages` (Anthropic-compat) | 200 | **pago — opt-in** |
| 4 | `POST /v1/responses` (OpenAI Responses) | 200 | **pago — opt-in** |

Os passos 3–4 (geração real upstream, pagos) só rodam com `OMNIROUTE_SMOKE_ALLOW_PAID=1`. Sem
isso, ficam **SKIP**. Rotas públicas confirmadas via rewrite do `next.config.mjs`
(`/v1/:path* → /api/v1/:path*`).

## Como rodar (operador)
```bash
# só auth/contrato (grátis):
OMNIROUTE_SMOKE_URL=https://SEU-HOST OMNIROUTE_SMOKE_KEY=<sua-api-key> \
  node scripts/smoke/authenticated-smoke.mjs

# incluindo os passos pagos de geração:
OMNIROUTE_SMOKE_URL=https://SEU-HOST OMNIROUTE_SMOKE_KEY=<sua-api-key> \
  OMNIROUTE_SMOKE_ALLOW_PAID=1 node scripts/smoke/authenticated-smoke.mjs
```
Env: `OMNIROUTE_SMOKE_URL` (default `http://127.0.0.1:20128`), `OMNIROUTE_SMOKE_KEY`,
`OMNIROUTE_SMOKE_ALLOW_PAID`, `OMNIROUTE_SMOKE_MODEL` (default: 1º modelo de `/v1/models`),
`OMNIROUTE_SMOKE_TIMEOUT_MS`. Nenhuma credencial é impressa. Exit 0 se todos os passos
não-SKIP passarem; 1 caso contrário.

## Verificação do próprio harness (feita aqui)
- `node --check`: sintaxe OK.
- Execução sem servidor: reporta `reachability FAIL` graciosamente (sem crash/stack).
- Paths batem com as rotas reais (`src/app/api/v1/{models,messages,responses}/route.ts`) + rewrite.

## Status
**BLOCKED_BY_EXTERNAL** para a execução real: depende de uma instância de pé + credencial de teste
do operador. Ao fornecê-la, rodar o comando acima fecha o item de smoke do gate.
