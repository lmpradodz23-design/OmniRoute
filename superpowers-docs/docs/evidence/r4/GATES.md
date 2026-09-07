# Gates — iteração 4 (release superpoderes)

Data: 2026-09-07. Branch código: `fase-1-loop-buzz`. Branch docs: `fase-0-auditoria`.

| Gate                         | Comando                                | Resultado                                    |
| ---------------------------- | -------------------------------------- | -------------------------------------------- |
| typecheck:core               | `tsc -p tsconfig.typecheck-core.json`  | **PASS** (0 erros) — `typecheck-core.txt`    |
| unit Fase 1 (Loop+Buzz)      | node --test (7 arquivos)               | **PASS** 31/31 — `fase1-tests.txt`           |
| lint (arquivos novos)        | `eslint <9 arquivos>`                  | **PASS** (0) — `lint-new.txt`                |
| secret scan (código)         | git grep padrões de segredo            | **PASS** (0 hits) — `secret-scan-code.txt`   |
| secret scan (deploy)         | git grep em docs/deploy                | **PASS** (0 hits) — `secret-scan-deploy.txt` |
| segredos do Buzz fora do git | `git check-ignore repos/buzz/.../.env` | **PASS** (repos/ ignorado)                   |
| compose merge (kit mobile)   | `docker compose config` (base+overlay) | **PASS** (RC=0)                              |

Notas:

- typecheck do dashboard inteiro é vermelho no baseline (JSX namespace etc.) e está **fora de escopo**;
  as páginas novas `loop`/`buzz` não adicionam erro próprio.
- Nenhum verde artificial: testes têm asserções reais (round-trip DB, deny de efeito destrutivo,
  aprovação humana, dedup de inbox, assinatura Nostr, precedência de config).
