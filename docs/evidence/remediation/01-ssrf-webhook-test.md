# Finding #1 — SSRF no teste de webhook (redirect + DNS rebinding)

- **Severidade:** high · **CWE-918** · categoria ssrf
- **Arquivos:** `src/app/api/webhooks/[id]/test/route.ts`, novo `src/shared/network/hardenedWebhookFetch.ts`

## Causa raiz
`testFetch` validava só a URL inicial (string do hostname), usava `fetch` (que segue redirect
por padrão) e decidia a redação do corpo pelo hostname inicial. Logo: (a) um destino público
que faz 302 para um serviço interno tem o corpo retornado (`redactBody=false`), e (b) um
hostname público que resolve para IP privado/metadata passa a validação e é conectado.

## Correção (causa raiz)
Novo helper `hardenedWebhookFetch`:
1. **Resolve A/AAAA** e valida **todos** os IPs resolvidos — metadata/link-local bloqueado
   incondicionalmente; privado só sob opt-in. A classificação usa o **IP resolvido**, não o
   hostname (fecha o DNS rebinding).
2. **Fixa o IP** validado via `undici.Agent({ connect: { lookup } })` — a conexão vai ao IP
   pré-validado; DNS não pode reassociar entre a checagem e o connect (TOCTOU). Host/SNI seguem
   o hostname.
3. **Nunca segue redirect** (`redirect: "manual"`; qualquer 3xx é diagnóstico bloqueado, sem corpo).
4. **Nunca devolve o corpo** de um destino privado (só diagnóstico de conectividade).
5. Timer manual com `clearTimeout` no finally e `agent.close()` — sem handle/tim/ socket órfão.

A rota passa `allowPrivate: arePrivateProviderUrlsAllowed()`, preservando o comportamento
local-first (opt-in) sem acoplar o helper ao flag global.

## Testes (regressão) — `tests/unit/api/webhooks/webhook-test-ssrf-rebinding.test.ts`
- Rebinding: hostname público que resolve para 169.254.169.254 → bloqueado (mesmo com opt-in).
- Rebinding: resolve para 10.x → bloqueado sem opt-in; com opt-in → `isPrivateTarget=true`.
- Público resolvido → ok, não privado.
- Literais: metadata / loopback / credenciais embutidas / protocolo não-http → bloqueados.
- Sem registros DNS → erro.
- **Redirect nunca seguido**: 302 → `redirect blocked`; servidor recebe só 1 request (o hop NÃO é buscado).
- Corpo de destino privado é retido (`bodyText === ""`).
- Mesmo destino privado sem opt-in → bloqueado por completo.

## Resultado (evidência real)
- `node --test` (arquivo novo + `webhook-url-ssrf-guard` existente): **18/18 pass, 0 fail**.
- `tsc --noEmit` (core): 0 erros nos arquivos tocados.
- `eslint` (com suppressions do repo): exit 0.
- Sem regressão no teste SSRF pré-existente.

## Pendências honestas
- Cobrir cada hop de redirect com revalidação seria redundante aqui (redirects são bloqueados);
  se no futuro se quiser permitir 1 hop, revalidar o Location pela mesma pipeline.
