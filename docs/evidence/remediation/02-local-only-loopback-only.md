# Finding #2 — Dispositivo da LAN opera rotas locais sem login

- **Severidade:** high · **CWE-306/284** · missing-authorization
- **Arquivos:** `src/server/authz/policies/management.ts` (import + gate)

## Causa raiz
O gate Tier-1 só rejeitava LOCAL_ONLY quando o peer NÃO era loopback **e** NÃO era LAN privada
(`!isLoopbackRequest && !isPrivateLanRequest`). Um dispositivo de LAN privada **pulava o gate
inteiro** e caía no fallback anônimo (`requireLogin=false → allow anonymous`), alcançando rotas
que instalam pacotes, iniciam subprocessos e leem/escrevem configuração do host — sem credencial.
(O acesso LAN a LOCAL_ONLY fora "owner-authorized" em 2026-05-30, mas a auditoria o classifica
como vuln HIGH pelo caminho anônimo/host-sensitive.)

## Correção (causa raiz)
- LOCAL_ONLY passa a ser **loopback-only**: removida a exceção `!isPrivateLanRequest`. Qualquer
  chamador não-loopback (LAN incluída) **passa pelo gate**.
- O carve-out autenticado já existente é o único caminho não-loopback: subset allow-list
  (`/api/mcp/*` etc.) exige **manage/admin** (ou `mcp:connect` para `/api/mcp/`) ou **sessão de
  dashboard** — este é o "TRUSTED_LAN", que exige auth real.
- Rotas host-sensitive/spawn (`/api/cli-tools/runtime/*`, NÃO bypassáveis) ficam **estritamente
  loopback** — inalcançáveis da LAN mesmo autenticado.
- Anônimo (`requireLogin=false`) nunca mais alcança LOCAL_ONLY a partir da LAN.
- Proteção anti-spoofing preservada: a localidade vem do peer real do socket (peer-stamp), nunca
  do header `host`.

## Testes — `tests/unit/authz/management-policy.test.ts` (novos, peer LAN 192.168.1.50)
- LAN + `/api/cli-tools/runtime/foo` + `requireLogin=false` → **403 LOCAL_ONLY** (fecha o host
  control anônimo).
- LAN + `/api/mcp/stream` sem auth → 403.
- LAN + `/api/mcp/stream` + manage key → allow (TRUSTED_LAN autenticado).
- LAN + spawn route + manage key → 403 (host control só em loopback, mesmo autenticado).
- (+ hygiene) `after()` fecha o DB antes do rmSync — elimina o EPERM de teardown no Windows.

## Resultado (evidência real)
- `management-policy.test.ts`: **22/22** (antes do fix o baseline tinha o mesmo EPERM de teardown;
  os subtestes de lógica sempre passaram — agora 0 EPERM).
- Regressão authz: **93/93** (pipeline, route-guard-local-prefix, discovery-routes-local-only,
  classify) — os testes de bypass existentes usam peer não-loopback e continuam válidos.
- `tsc --noEmit` (core): 0 erros nos arquivos; `eslint` (com suppressions): exit 0.
