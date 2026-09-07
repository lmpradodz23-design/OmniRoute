# Evidência — Reprodução comparativa das falhas de auth-policy (item 2)

Objetivo: NÃO classificar as falhas como "fixture" sem prova. Reprodução controlada,
variando UM fator por vez, no commit congelado, sem alterar código.

## Progressão medida (dir tests/unit/authz, glob absoluto)

| #   | Condição                                                                               |      ok |  fail | Observação                                       |
| --- | -------------------------------------------------------------------------------------- | ------: | ----: | ------------------------------------------------ |
| 1   | `--test-isolation=none` (modo `test:unit:fast`), sem env CI                            |     215 |    35 | + 138 `ERR_INVALID_ARG_VALUE` (createRequire)    |
| 2   | idem + **env canônicas do CI** (JWT_SECRET/API_KEY_SECRET/OMNIROUTE_SKIP_SYSTEM_TRUST) |     215 |    35 | **env NÃO muda nada** — refuta a hipótese de env |
| 3   | **isolamento canônico** (SEM `--test-isolation=none`, `--test-concurrency=4`) + env CI | **232** | **5** | 30 falhas somem                                  |

## Causas provadas (não são defeito de código)

1. **~30 falhas = contaminação de `process.env` sob `--test-isolation=none`.** Código:
   `scripts/dev/peer-stamp.mjs:95` faz `process.env.OMNIROUTE_PEER_STAMP_TOKEN ||= randomUUID()`
   (lazy). Com todos os arquivos no MESMO processo + concorrência, outro teste injeta um
   UUID em `process.env` e vence o `beforeEach` que setava `stamp-tok` → `actual: '<uuid>|ip'`
   vs `expected: 'stamp-tok|ip'`. Com isolamento por-arquivo (canônico) isso desaparece.
2. **5 falhas restantes (2 arquivos) = `EPERM` do Windows em diretório temp.** Erro real:
   `Error: EPERM, Permission denied: \?\C:\Users\zodyp\AppData\Local\Temp\omr-*`. É a mesma
   classe EBUSY/EPERM do Windows (lock/Defender em temp/SQLite), **não** lógica. Não ocorre
   em Linux (tmpfs). Arquivos: `client-api-policy-fallback.test.ts`, `management-policy.test.ts`.
3. **`ERR_INVALID_ARG_VALUE`** (createRequire) = `runtimeRequire.ts:13` `createRequire(argv[1])`
   com glob relativo sob `node --test`; some com caminho absoluto (evid. 17).

## Conclusão

As falhas de auth-policy decompõem-se em (a) modo de isolamento errado do meu run (fast),
(b) `EPERM` de FS do Windows e (c) artefato de invocação. **Nenhuma é regressão ou bug do
código congelado.** Predição: a suíte canônica em **Linux** (isolamento por-arquivo, sem
EPERM/argv) fica **verde**. Confirmação canônica → Docker Linux (evid. 19).
