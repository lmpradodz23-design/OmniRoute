# Evidência — Busca de baseline verde + limite do fork (Opção 1)

## Runs executados no fork (todos evento workflow_dispatch)

| Candidato              | Linha/versão     | Run         | Jobs confiáveis (8 shards, integração, lint, docs-sync, security)               | Build/Vitest |
| ---------------------- | ---------------- | ----------- | ------------------------------------------------------------------------------- | ------------ |
| f9a1cc8 (frozen)       | release/v3.8.51  | 34093531998 | ❌ 7/8 shards fail, integração fail, lint fail                                  | ❌           |
| d26fe038 (ancestral)   | release/v3.8.51  | 34095751362 | ❌ integração fail + 6/8 shard fail (lint/docs/security ✓, 7/8 shards ✓)        | ❌           |
| **c0b2253 (CONTROLE)** | **main/v3.8.50** | 34097249734 | ✅ **8/8 shards, integração 1/2+2/2, lint, docs-sync, security — TODOS verdes** | ❌           |

## Achado crítico (controle)

`c0b2253` é **full-green no CI oficial do upstream** (run 33819289311: TODOS os jobs verdes,
incl. Build e Vitest, sem skip dos pesados). No **nosso fork**, com o mesmo commit, **Build e
Vitest FALHAM** — enquanto todos os jobs de código passam.
→ **Build e Vitest falham no fork para QUALQUER commit (mesmo um verde no upstream)** =
**artefato de fork/infra** (provável dependência de runner self-hosted/recursos/secrets que o
fork não tem), **não defeito de código**.
→ **Consequência:** a exigência "CI do fork integralmente verde" é **insatisfazível num fork**
(Build/Vitest nunca ficam verdes lá). Os jobs _confiáveis_ no fork são: 8 shards, integração,
lint, docs-sync, security.

## Leitura dos candidatos (nos jobs confiáveis)

- **c0b2253**: verde em todos os confiáveis + full-green oficial no upstream. **Mas**: main,
  **v3.8.50** (regride vs 3.8.51), **divergiu 3712 commits** de f9a1cc8; **vendor
  codex-chatgpt-web v4.0.7 NÃO confirmado** nesse ref (path/versão pode diferir).
  Compatível: /v1/messages ✓, /v1/responses ✓, engines.node ✓.
- **d26fe038**: altamente compatível (release/v3.8.51, ancestral, APIs+vendor+engines idênticos),
  **mas realmente vermelho** (integração + 1 shard falham — jobs confiáveis).
- **f9a1cc8**: vermelho.

## Conclusão

- **Nenhum SHA é simultaneamente (a) verde nos jobs confiáveis E (b) plenamente compatível**
  (mesma linha release/v3.8.51 + vendor v4.0.7): c0b2253 é verde mas divergente/main/v3.8.50;
  d26fe038 é compatível mas vermelho.
- Pela regra 9 do aprovador, isto tende a **manter NO-GO** e exigir proposta separada de
  correções — OU aceitar c0b2253 com ADR e caveats. Decisão do aprovador.
- Nenhum teste/código alterado; upstream intocado.
