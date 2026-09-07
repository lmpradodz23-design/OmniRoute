# ADR-003 — Integração de Loop Engineering e Block Buzz (auditoria + abordagem)

- **Status:** **AUDITADO — início de integração** (código de adaptadores atrás de feature flag).
  Depende da Fase 0 (R3-A) e do disco. Gate geral permanece **NO-GO** até R3-A verde + provas.
- **Data:** 2026-09-07.
- **Contexto:** componentes #8 (Loop Engineering) e #9 (Block Buzz) do plano mestre. O plano
  **bloqueia** o início deles até a Fase 0 ficar verde; este ADR faz a **auditoria** (leitura,
  licença, SHA, arquitetura, interface) e define a **abordagem de integração**, sem subir os
  serviços pesados (restrição de disco: ~1,8 GB livres em C:).

## 1. Loop Engineering — auditoria

- **Repo/SHA:** `github.com/cobusgreyling/loop-engineering` — SHA congelado `1d1af34b5d4b1af8bd5fc963ab2ff18499e706ff` (HEAD atual `9973a5c…`; ao integrar, **fixar o SHA congelado**).
- **Licença:** **MIT** ✅ (Cobus Greyling and contributors, 2026).
- **Natureza:** **biblioteca de padrões/metodologia** (npm `@cobusgreyling/loop`) + markdown
  (LOOP.md, loop-budget.md, loop-constraints.md, gate.yaml, `.claude-plugin`). **Não é serviço
  pesado, não é container.** "It is not a 'rewrite the module' button."
- **Modelo:** você desenha um _loop_ — descobrir trabalho → passar a agentes → verificar →
  persistir estado — em vez de digitar o próximo prompt. Loops têm: cadência, skill, `STATE.md`,
  **fase report-only**, **verifier** obrigatório, **budget**, **worktrees por tentativa**,
  **human gate** (handoff). Padrões: daily-triage, pr-babysitter, dependency-sweeper,
  changelog-drafter, ci-sweeper.
- **Segurança (bate com o plano §):** report-only no início; nenhum loop faz merge/deploy/compra/
  mensagem sem aprovação; verifier independente pode reprovar.

### Abordagem de integração (Loop)

- Entra como **módulo leve** no OmniRoute. O **Policy Engine + aprovações do OmniRoute = o human
  gate**; o Loop **propõe**, o OmniRoute **decide**. Estado durável (tasks/runs/checkpoints/
  aprovações/resultados) vive no **PostgreSQL/SQLite do OmniRoute** — Loop **não** é fonte de verdade.
- Ponte por **outbox/inbox** com idempotência: `sequence_number`, `correlation_id`, `task_id`,
  `run_id`, deduplicação. **Viável agora** (sem disco pesado).

## 2. Block Buzz — auditoria

- **Repo/SHA:** `github.com/block/buzz` — SHA congelado `3c7f288c60d67df78577b237e27c3dfc8831aaa1`
  = **HEAD/main atual** ✅ (confirmado por `git ls-remote`).
- **Licença:** **Apache-2.0** ✅ (Block, Inc.).
- **Natureza:** **plataforma de colaboração** (monorepo **Rust**) — workspace onde humanos e
  agentes compartilham salas, sobre o **protocolo Nostr (NIP-01)**. Toda ação (mensagem, reação,
  passo de workflow, evento git, aprovação) é um **evento Nostr assinado** identificado por `kind`.
- **Arquitetura:** o **`buzz-relay` (Axum)** é a **fonte única de verdade** — clientes conectam por
  **WebSocket**; há **HTTP bridge** (`/events`, `/query`, `/count`, `/hooks/{id}`, `/media/*`,
  `/git/*`, `/info`, NIP-05). Auth NIP-42/NIP-98. Comunidade selecionada pelo host. Sem P2P/gossip.
- **Rodar:** exige **build do monorepo Rust** + serviços (relay/DB/armazenamento) → **pesado**;
  **inviável com 1,8 GB livres**. A auditoria e o **desenho do adaptador** são viáveis agora.

### Abordagem de integração (Buzz)

- **Serviço separado e opcional** (o `buzz-relay`), com **estado próprio** (event log/relay).
  Fonte de verdade **apenas** de canais, conversas, membros e eventos colaborativos.
- OmniRoute conecta via **adaptador tipado Buzz** (WebSocket/Nostr + HTTP bridge), **sem chamadas
  espalhadas** — o OmniRoute continua **plano de controle e dono das políticas**.
- **Identidade:** mapear `tenant_id`/`workspace_id`/`user_id`/`agent_id`/**`buzz_pubkey`**. Uma
  **chave Nostr NÃO autoriza** ação no OmniRoute automaticamente.
- Ponte com **outbox/inbox, idempotência, `sequence_number`, `correlation_id`, `task_id`, `run_id`,
  deduplicação** (sem dupla fonte de verdade).

## 3. Viabilidade agora (honesta, disco ~1,8 GB)

| Item                                                               | Viável agora?                                     |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| Auditoria (licença, SHA, arquitetura, interface)                   | ✅ feito (este ADR)                               |
| **Loop Engine** — módulo report-only + ponte outbox/inbox          | ✅ código viável (leve)                           |
| **Buzz** — adaptador tipado (esqueleto, feature-flag OFF)          | ✅ código viável (sem subir o relay)              |
| **Buzz** — subir o `buzz-relay` de verdade (build Rust + serviços) | 🛑 **bloqueado por disco** (precisa de vários GB) |

## 4. Decisão / próximos passos

1. **Loop Engine:** implementar o módulo report-only no OmniRoute (fixando o SHA congelado),
   com estado no DB do OmniRoute e human gate = Policy Engine. Atrás de feature flag.
2. **Buzz:** criar o **adaptador tipado** (contratos de eventos/ACP + ponte outbox/inbox),
   feature-flag OFF, **sem** subir o relay — a execução real do relay fica para quando houver disco.
3. Não criar dupla fonte de verdade; toda ponte idempotente. Loop report-only; Nostr key ≠ autorização.
4. Manter o gate geral **NO-GO** até a R3-A ficar verde (prova ao-vivo do ChatGPT) e as provas dos
   novos módulos. Nada de efeito externo sem aprovação.
