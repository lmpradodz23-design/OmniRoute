# Finding #7 — Cópia do banco revela chaves de API ativas

- **Severidade:** high · **CWE-312** · sensitive-data-exposure
- **Arquivos:** `src/lib/db/apiKeys.ts`, `src/lib/db/core.ts` (hook de migração)

## Causa raiz
A coluna `api_keys.key` guardava a chave bearer em **texto puro** ao lado do `key_hash`. A
validação já aceitava o hash (`WHERE key = ? OR key_hash = ?`), então o plaintext recuperável não
era necessário para auth — mas uma leitura do banco/backup entregava chaves ativas usáveis.

## Decisão de abordagem
Escolhida a **Opção B endurecida** (cifra no repouso + validação só por hash), não a hash-only
pura (Opção A). Motivo: consumidores internos reutilizam a chave em claro para auto-autenticar
chamadas internas (`pickApiKeyForInternalUse`). A Opção A exigiria redesenhar essa auto-auth +
rotação forçada de chaves — mudança de auth que não se verifica de ponta a ponta aqui. A Opção B
fecha o achado real (banco/backup não contêm mais chave usável em claro) sem quebrar a auth. A
Opção A fica como hardening futuro documentado.

## Correção (causa raiz)
- **Validação só por hash:** `_stmtValidateKey` e `_stmtGetKeyMetadata` passam a `WHERE key_hash = ?`
  (removido `OR key = ?`); os call sites passam só `hashedKey`. A chave em claro deixa de ser
  necessária para auth.
- **Cifra no repouso:** `createApiKey` e `regenerateApiKey` gravam `encryptSensitive(key)` na coluna
  `key` (fail-closed em produção via #3). O retorno mantém o plaintext (revelação única).
- **Decifra na leitura:** `getApiKeys`/`getApiKeyById` decifram `key` — o reuso interno e a máscara
  continuam com plaintext; chave ausente/trocada → null (inutilizável), nunca ciphertext exposto.
- **Migração idempotente:** `encryptExistingApiKeyPlaintext()` cifra linhas legadas em plaintext
  (skip de `enc:v1:`), transacional; ligada no init do DB. A chave segue validando (hash inalterado).

## Testes — `tests/unit/db-apikey-encryption-at-rest.test.ts`
- create grava `enc:v1:` no repouso; `validateApiKey(plaintext)` = true (hash-only); `getApiKeyById.key`
  decifra ao plaintext.
- backfill migra a linha forçada a plaintext; a chave segue validando; idempotente (0 na 2ª vez).
- regenerate grava ciphertext, nova chave valida, antiga não valida.

## Resultado (evidência real)
- `node --test` (arquivo novo): **3/3**.
- Regressão apiKeys/auth: **197 subtestes de lógica passam** (management-policy, access-token-scopes,
  api-key-scope-validation, lifecycle, regeneration, cloud-agent-cred, command-code, etc.). Os únicos
  2 "arquivos vermelhos" (api-key-lifecycle, api-key-regeneration) falham SÓ no **EPERM de teardown do
  Windows — idêntico no baseline** (ambiental; passa no CI/Linux); todos os subtestes de lógica passam.
- `tsc --noEmit` (core): 0 erros nos arquivos; `eslint` (com suppressions): exit 0.

## Migração e rollback
- Não-destrutiva: o plaintext é recuperável via `decrypt()` com a mesma `STORAGE_ENCRYPTION_KEY`;
  o `key_hash` (fonte da auth) nunca muda. Rollback do código é seguro mantendo a chave.

## Hardening futuro (Opção A)
Persistir só `key_hash`+`key_prefix` (sem coluna `key` recuperável) + rotear `pickApiKeyForInternalUse`
pelo machine/internal-service token — elimina o resíduo (DB + STORAGE_ENCRYPTION_KEY juntos). Exige
rotação de chaves e refatoração da auto-auth interna.
