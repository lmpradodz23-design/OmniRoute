# FINAL_THREE_AGENT_REVIEW — release superpoderes (Loop + Buzz + painel + kit mobile)

Data: 2026-09-07. Branch código: `fase-1-loop-buzz`. Três auditorias independentes (isoladas entre si).
**Nenhum auditor encontrou CRITICAL ou HIGH.** Gate de conclusão (CRITICAL=0, HIGH=0) **satisfeito**.

## Veredictos

- **Auditor A (Arquitetura):** 0 CRIT / 0 HIGH. 3 MEDIUM (M1, M2, M3), 3 LOW, 2 IMPROVEMENT.
- **Auditor B (Segurança):** 0 CRIT / 0 HIGH. 2 MEDIUM (B-1, B-2), LOW (tenant_id, guards, verbosidade).
- **Auditor C (Produto/QA/UX):** 0 CRIT / 0 HIGH. 2 MEDIUM (C-1, C-2), 4 LOW.

## Disposição de cada achado

| #        | Sev | Achado                                                                                                     | Disposição                                                                                                   | Evidência                                                                          |
| -------- | --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| A-M1     | MED | Retry não auto-incrementava `attempts` → laço verify ilimitado se o chamador não passa `consumed.attempts` | **CORRIGIDO** (motor conta a tentativa) + teste novo sem hand-set                                            | `stateMachine.ts:82`; teste `loop-engine-core` "teto AUTO-IMPOSTO"                 |
| A-M2b    | MED | publish usava relógio quando `createdAt` ausente → id muda entre retries (dedup quebra)                    | **CORRIGIDO** (enqueue carimba `createdAt` estável; publish usa o persistido)                                | `buzzBridge.ts` enqueue; `wsAdapter.ts` publish; teste "enqueue carimba createdAt" |
| A-M2c    | LOW | publish re-assina com a chave do agente (ignora pubkey do produtor)                                        | **DOCUMENTADO** (por design: chave Nostr nunca autoriza; autoria de saída é do agente)                       | comentário em `wsAdapter.ts` publish                                               |
| A-M2a    | LOW | id da linha do outbox ≠ id Nostr assinado                                                                  | **ACEITO/DOCUMENTADO**: dedup do relay usa o id assinado, agora estável entre retries                        | idem                                                                               |
| A-M3     | MED | outbox/inbox sem produtor/consumidor de produção (biblioteca testada, não feature ligada)                  | **DOCUMENTADO** como limitação honesta no release (inerte até haver produtor + relay + flag)                 | RELEASE_SUPERPOWERS "limitações"                                                   |
| A-L1     | LOW | flush sem lock de concorrência e sem requeue de `failed`                                                   | **DEFERIDO** (pós-ligar a flag; risco baixo, better-sqlite3 síncrono)                                        | limitações                                                                         |
| A-L2     | LOW | flag `authed` morta/otimista                                                                               | **CORRIGIDO** (removida)                                                                                     | `wsAdapter.ts`                                                                     |
| A-L3     | LOW | `MAX(seq)+1` não atômico                                                                                   | **DEFERIDO** (single-thread; sem impacto em dedup por PK)                                                    | limitações                                                                         |
| B-1      | MED | PUT /api/buzz não gated por flag                                                                           | **DOCUMENTADO** (intencional: config-before-enable; não conecta; admin-only)                                 | comentário em `buzz/route.ts` PUT                                                  |
| B-2      | MED | relayUrl sem allowlist (SSRF autenticado)                                                                  | **ACEITO/DOCUMENTADO** (alvo local por design; admin já controla o host; só fala Nostr WS; não vaza segredo) | limitações + comentário                                                            |
| B/tenant | LOW | tabelas novas sem `tenant_id`                                                                              | **DEFERIDO** para multi-tenant (single-tenant DZ23 hoje)                                                     | limitações                                                                         |
| C-1      | MED | mistura de idioma (sidebar EN vs página PT)                                                                | **CORRIGIDO** (subtítulos do sidebar em PT-BR)                                                               | `sections.ts`                                                                      |
| C-2      | MED | a11y: inputs sem label associado; toggle sem aria-expanded; ícones sem aria-hidden                         | **CORRIGIDO** (aria-label/htmlFor+id/aria-expanded/aria-hidden)                                              | `loop/page.tsx`, `buzz/page.tsx`                                                   |
| C-3      | LOW | advance/decide engoliam falha                                                                              | **CORRIGIDO** (checa res.ok, mostra erro)                                                                    | `loop/page.tsx`                                                                    |
| C-4      | LOW | deep-link `?q=` ignorado                                                                                   | **CORRIGIDO** (FeatureFlagsGrid semeia `search` do `?q=`)                                                    | `FeatureFlagsGrid.tsx`                                                             |
| C-5      | LOW | botão flush ativo com flag OFF                                                                             | **CORRIGIDO** (desabilitado + tooltip)                                                                       | `buzz/page.tsx`                                                                    |
| C-6      | LOW | docs: contagem de provedores inconsistente; hint de curl 101 enganoso                                      | **CORRIGIDO**                                                                                                | `HARNESS_RECIPES.md`, `buzz-mobile-tls/README.md`                                  |
| A-IMP    | IMP | conclusão exige steps>0; close() não limpa mapas                                                           | **DEFERIDO** (benigno em report-only / ciclo curto)                                                          | limitações                                                                         |

## Retest após correções

- `typecheck:core` = **0 erros**.
- Suíte Fase 1 = **33/33** (era 31; +2 testes que provam A-M1 e A-M2b).
- Lint dos arquivos alterados = PASS.
- Nenhum verde artificial: os 2 testes novos falhariam sem as correções (retry ilimitado / createdAt volátil).

## Conclusão

Todos os CRITICAL/HIGH: **0**. MEDIUM acionáveis e baratos: **corrigidos**. MEDIUM/LOW de arquitetura
do caminho Buzz (inerte, flag OFF): corrigidos os de causa-raiz barata (M1, M2b, L2) e **documentados
com honestidade** os demais como limitações conhecidas a endereçar antes de ligar a flag em produção
multi-tenant/exposta. Release **apto** para open-source (dogfood single-tenant + PR).
