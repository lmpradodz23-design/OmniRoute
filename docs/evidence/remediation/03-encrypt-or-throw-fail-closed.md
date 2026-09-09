# Finding #3 — Criptografia fail-open grava credenciais em texto puro

- **Severidade:** high · **CWE-312/636** · sensitive-data-exposure
- **Arquivos:** `src/lib/db/encryption.ts` (contrato), `src/lib/cloudAgent/credentials.ts`,
  `src/lib/db/commandCodeAuth.ts`, `src/lib/services/apiKey.ts` (writers), `src/lib/db/core.ts` (gate)

## Causa raiz
`encrypt()` faz **passthrough (retorna plaintext)** sem `STORAGE_ENCRYPTION_KEY` ou após erro. Os
writers checavam `if (!encrypted) throw` — mas plaintext é não-vazio, então a checagem passa e o
segredo é gravado em texto puro achando que foi cifrado.

## Correção (causa raiz) — contrato fail-closed
Novos em `encryption.ts`:
- `EncryptionUnavailableError`.
- `encryptOrThrow(plaintext)`: retorna ciphertext real `enc:v1:` **ou lança** — nunca passthrough.
- `isStorageEncryptionRequired()`: fail-closed quando o perfil é exposto/produção
  (`NODE_ENV=production`) ou por opt-in explícito (`OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION`); dev/test
  → passthrough (o flag explícito tem precedência, inclusive sobre o contexto de teste).
- `encryptSensitive(plaintext)`: contrato dos writers — `encryptOrThrow` no perfil exigido, senão
  `encrypt` (conveniência de dev).
- `assertStorageEncryptionConfigured()`: **gate de startup** — lança em perfil exigido sem chave;
  ligado no init do DB (`core.ts`) antes de `setDb`, então uma instância exposta sem chave
  **recusa iniciar** em vez de gravar plaintext. No-op em dev/test.

Writers convertidos para `encryptSensitive` (rejeitam a escrita sem chave em produção):
`saveCloudAgentCredential`, `markCommandCodeAuthSessionReceived`, `services/apiKey`.

## Testes — `tests/unit/db-encrypt-or-throw.test.ts`
- `encryptOrThrow` lança sem chave; rejeita input vazio; idempotente para já-cifrado; cifra com chave.
- perfil exigido + sem chave → `encryptSensitive` e o gate de startup **lançam**.
- perfil dev + sem chave → passthrough + gate no-op.

## Resultado (evidência real)
- `node --test` (arquivo novo): **5/5**.
- Regressão: **13/13** (webhook-secret + ssrf-guard, init do DB com o novo gate) e **9/9**
  (cloud-agent-credentials, db-command-code-auth, migration-071) — writers convertidos sem quebra.
- `tsc --noEmit` (core): 0 erros nos arquivos; `eslint` (com suppressions): exit 0.

## Varredura dos demais writers — CONCLUÍDA
Todos os writers com `encrypt()` passthrough foram convertidos para `encryptSensitive`
(fail-closed em perfil exposto): `db/obsidian.ts` (token + password), `db/radar.ts` (key),
`db/settings.ts` (oidcClientSecret), `logExport/secrets.ts`, `webhookDispatcher.ts` (metadata) e
`db/secrets.ts` (`persistSecret`/`getPersistedSecret`). **Achado extra:** `persistSecret` — usado
pelo `login:start` do Electron para salvar credenciais de provedor — gravava em **texto puro**;
agora cifra no repouso + decifra na leitura (legado plaintext segue lido via passthrough do
`decrypt`).

Testes: `tests/unit/db-secrets-encryption.test.ts` (ciphertext no repouso, round-trip, legado
plaintext). Regressão: **207/207** nos testes unitários dos writers (db-secrets, db-settings,
obsidian, log-export, cli-radar). tsc 0 erros; eslint exit 0.

## Follow-up remanescente
A "readiness que detecta campos sensíveis sem envelope" (varredura de todas as colunas) permanece
como follow-up — o gate de startup + todos os writers de credencial fechados já cobrem o caminho.
