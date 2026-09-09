# Finding #8 — Segredo de webhook em texto puro (forja de webhooks assinados)

- **Severidade:** medium · **CWE-312** · sensitive-data-exposure
- **Arquivos:** `src/lib/db/webhooks.ts`, `src/lib/db/core.ts` (hook de migração)

## Causa raiz
`webhooks.secret` (chave HMAC `whsec_…`) era gravada em texto puro no INSERT/UPDATE e usada
diretamente como chave HMAC. Uma leitura do banco/backup permite forjar eventos assinados.

## Correção (causa raiz)
- **Cifra no write:** `createWebhook`/`updateWebhook` cifram o segredo (`encrypt`, AES-256-GCM
  `enc:v1:`) antes de persistir.
- **Decifra na leitura:** `rowToWebhook` decifra o `secret`, então todos os consumidores internos
  (HMAC no dispatcher e na rota de teste) continuam recebendo o plaintext — sem alterar os leitores.
  O banco/backup passa a conter **apenas ciphertext**. Chave ausente/trocada → `secret=null` → a
  entrega vai **sem assinatura** em vez de assinada com chave errada (fail-safe).
- **Migração idempotente:** `encryptExistingWebhookSecrets()` cifra linhas legadas em plaintext
  (skip de valores já `enc:v1:`), transacional; ligada no init do DB (`core.ts`) ao lado da
  migração de cifra legada. No-op sem chave.

## Testes — `tests/unit/db-webhook-secret-encryption.test.ts`
- create/update armazenam `enc:v1:` no repouso; leitor decifra ao plaintext.
- backfill migra 1 linha legada; **assinatura HMAC idêntica antes/depois** (round-trip exato);
  segunda execução migra 0 (idempotente).

## Resultado (evidência real)
- `node --test` (arquivo novo): **4/4**.
- Regressão webhook: **46/46** (db-webhooks, ssrf-guard, ssrf-rebinding, dispatcher-routing,
  discord-dispatcher, deliveries-db, metadata-guard, cli-webhooks) — sem quebra (import circular
  core↔webhooks não afeta o init).
- `tsc --noEmit` (core): 0 erros nos arquivos; `eslint` (com suppressions): exit 0.

## Migração e rollback
- Migração não-destrutiva: o plaintext é totalmente recuperável via `decrypt()` com a mesma
  `STORAGE_ENCRYPTION_KEY`. Rollback do código é seguro mantendo a chave (um passo de decrypt-in-place
  restauraria plaintext; sem ele, o código antigo leria `enc:` e a entrega ficaria sem assinatura —
  fail-safe, nunca forjável).

## Dependência (Fase 1 #3)
O "falhar sem chave" em perfil exposto pertence ao finding #3 (`encryptOrThrow` + gate de startup),
que generaliza a política. Aqui a cifra é aplicada sempre que há chave (o cenário de produção).
