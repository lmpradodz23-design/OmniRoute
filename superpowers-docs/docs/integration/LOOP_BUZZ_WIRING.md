# Loop Engine + Buzz — wiring no OmniRoute (estado e próximos passos)

> Branch `fase-1-loop-buzz` (a partir de `r3-backport-base`). Tudo **aditivo**, atrás de
> feature flags **OFF**, sem regressão. Configuração no **painel único** do OmniRoute.

## O que já está pronto (código + testes)

| Peça                          | Onde                                                | Estado                                                                                     |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Loop Engine — núcleo puro** | `open-sse/loop-engine/`                             | ✅ types + budget + policyGate + stateMachine + API; **8/8 testes**                        |
| **Buzz Bridge — núcleo puro** | `open-sse/buzz-bridge/`                             | ✅ types + outbox/inbox idempotente + adapter inerte + guarda de segurança; **7/7 testes** |
| **Persistência**              | `migrations/175_loop_engine_and_buzz_bridge.sql`    | ✅ tabelas `loop_runs/loop_steps/buzz_outbox/buzz_inbox` (aditiva/idempotente)             |
| **Feature flags**             | `featureFlagDefinitions.ts`                         | ✅ `LOOP_ENGINE_ENABLED`, `BUZZ_HUB_ENABLED` (default OFF, aparecem no painel)             |
| **Auditoria/decisões**        | `docs/adr/ADR-003-*`, `docs/HARNESS_INTEGRATION.md` | ✅                                                                                         |

## Como conecta ao painel único

- As duas flags são `category: runtime` → surgem na tela de **Feature Flags** do dashboard
  (o mesmo painel que já configura tudo). Ligar/desligar não exige restart.
- Estado durável vive nas tabelas da migração 175 (DB do OmniRoute = fonte de verdade).
- Nenhuma UI separada: a configuração de Loop/Buzz entra nas seções existentes
  (AGENTIC FEATURES / CONFIGURATION).

## O que falta (quando houver disco/relay) — sem placeholders, só o que for real

1. **Camada de repositório** (DB ↔ núcleos): funções para persistir/ler `loop_runs/steps` e
   `buzz_outbox/inbox` usando os tipos já definidos. _(Leve, viável já.)_
2. **Loop runner report-only**: serviço que avança `advance()` em cadência, gravando no DB e
   pedindo aprovação ao **Policy Engine** do OmniRoute (nunca efeito sem aprovação). _(Leve.)_
3. **WebSocketBuzzAdapter**: implementação real do `BuzzAdapter` contra o `buzz-relay`
   (WebSocket/Nostr + HTTP bridge). **Requer o buzz-relay rodando** → build Rust + serviços →
   **depende de disco** (hoje insuficiente). O `resolveBuzzAdapter()` já troca do inerte para
   o real por flag quando existir.
4. **Seções no dashboard**: cards de Loop (runs/steps/aprovações) e Buzz (canais/eventos) no
   painel único, reusando os componentes de conexões/health existentes.

## Rodar o buzz-relay (mais tarde, com disco)

O repo `block/buzz` (@`3c7f288`, Apache-2.0) traz `Dockerfile`, `Dockerfile.push-gateway`,
`Dockerfile.sprig` e um `Justfile`. Quando houver espaço (vários GB p/ build Rust + serviços):

- subir o relay pelo Docker/Just do próprio Buzz (DB/armazenamento próprios);
- configurar a URL do relay no painel do OmniRoute;
- ligar `BUZZ_HUB_ENABLED` → `resolveBuzzAdapter(true)` passa a usar o WebSocketBuzzAdapter.

## Segurança (garantida no núcleo)

- **Loop report-only**: `policyGate` é determinístico; efeito destrutivo=deny; sensível/report-only=
  require_approval. Nada externo sem aprovação.
- **Buzz**: `nostrKeyAuthorizes()===false` — uma chave Nostr **nunca** autoriza no OmniRoute;
  `buzzIdentityIsMapped` é fail-closed. Ponte idempotente (dedup por id, ordenação por sequence).
