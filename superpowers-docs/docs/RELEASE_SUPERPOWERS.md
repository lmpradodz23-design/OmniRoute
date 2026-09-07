# OmniRoute Unified — release "superpoderes" (para PR/open-source)

> Tudo **open-source e gratuito**, **aditivo e sem regressão**, atrás de **feature flags OFF**
> por padrão. Nenhum segredo no git. Base: baseline verde `c0b2253` (main, v3.8.50, MIT).

## Branches para devolver ao git

- `r3-backport-base` — **R3-A**: provider ChatGPT Web (Codex v4.0.7) sobre a base verde.
  _(já empurrada para `lmpradodz23-design/OmniRoute`)_
- `fase-1-loop-buzz` — **superpoderes** (Loop + Buzz), baseada na R3-A. **A empurrar.**

## O que este release adiciona

### 1. Provider ChatGPT Web / Codex (R3-A) — MIT

Backport auditado do `miuuyy/codex-chatgpt-web` v4.0.7 + migração de convergência 174.
`/v1/messages` (Anthropic) e `/v1/responses` (OpenAI) provados ao vivo.

### 2. Loop Engine (módulo report-only) — deriva de `cobusgreyling/loop-engineering` (MIT)

- Núcleo puro: ciclo discover→…→escalate, **budget** (estourou→aborta), **policy gate
  determinístico** (código decide; efeito destrutivo=deny, sensível=require_approval).
- **Runner** + **REST `/api/loop`** (autenticado, gated por `LOOP_ENGINE_ENABLED`).
- Estado durável no DB (migração 175). **14 testes**. Nenhum efeito externo sem aprovação humana.

### 3. Buzz Bridge (colaboração humano+agente via Nostr) — integra `block/buzz` (Apache-2.0)

- **Serviço separado** (buzz-relay, rodado via Docker — NÃO vendorizado, sem conflito de licença).
- Ponte tipada + **outbox/inbox idempotente**; **assinatura Nostr** (schnorr/secp256k1 via
  `@noble/curves` MIT); **WebSocketBuzzAdapter** com auth NIP-42; **buzzService** (identidade
  persistida + flush do outbox). Gated por `BUZZ_HUB_ENABLED`.
- **Prova E2E ao vivo:** OmniRoute publica evento assinado no relay real (`published=1`).
- Segurança: **chave Nostr NUNCA autoriza** ação no OmniRoute. **15 testes**.

### 4. Cards operáveis no painel único — MIT

Seção **Agentic Features**: `/dashboard/loop` (listar/iniciar ciclos report-only, avançar 1 passo,
aprovar/rejeitar etapas que aguardam aprovação humana) e `/dashboard/buzz` (status do relay, pubkey
do agente, contagens do outbox/inbox, "publicar pendentes", e a **URL do relay editável pelo painel**
— precedência painel → env → default). Endpoints `GET/PUT /api/buzz` e `POST /api/buzz/flush`.
Itens sempre visíveis com CTA de ativação (o gate real é server-side). **Fase 1: +2 testes** (31 no total).

### 5. Memória vetorial Qdrant — já no base, certificada ao vivo

O OmniRoute base **já traz** cliente Qdrant (`src/lib/memory/qdrant.ts`) + sqlite-vec local +
painel Memory (Engine/QdrantConfigCard) + embeddings. **Prova E2E ao vivo** contra o
`omniroute-qdrant`: criar coleção, upsert multi-tenant, **busca filtrada por tenant (ACL)**, delete
e drop — tudo OK. Sem código novo (evita duplicação); liga-se com `QDRANT_HOST=localhost` no painel.

### 6. Acesso mobile ao Buzz (falar com agentes pelo celular) — grátis

Kit de deploy `docs/deploy/buzz-mobile-tls/` (Caddy + Let's Encrypt): overlay compose **aditivo**
que termina TLS para o seu domínio e faz proxy WS ao relay **preservando o Host** (o relay resolve a
comunidade pelo Host — era a causa do 404 em túnel/IP). Merge do compose validado (`docker compose config` OK).

### Documentação

`HARNESS_RECIPES.md` (Continue/Cline/Aider/OmniCopilot/Hermes/Claude Code/Codex),
`HARNESS_INTEGRATION.md` (roadmap universal), `ADR-003`, `LOOP_BUZZ_WIRING.md`, `EXTERNAL_SOURCES.md`,
`deploy/buzz-mobile-tls/README.md` (acesso mobile).

## Certificação

- **Suíte superpowers: 63/63 testes verdes** (Loop/Buzz 36 + PII-BR 4 + MCP 6 + Browser 6 + AG-UI 6 + OTel 5). `typecheck:core` oficial = **0 erros**. Lint/hooks PASS.
- Painel: páginas `loop`/`buzz` não adicionam erro ao typecheck do dashboard (baseline pré-existente).
- Qdrant: prova E2E ao vivo (upsert multi-tenant + busca filtrada por tenant + delete/drop).
- R3-A: cleanroom 52/52, regressão browserPool 10/10, migração 174 P1/P2, health 200.
- Deps novas: `@noble/curves` MIT, `@noble/hashes` MIT. Nenhum segredo rastreado.

## Como devolver ao git (open-source)

```bash
# codigo (superpoderes)
git -C repos/OmniRoute-r3-c0b2253 push -u myfork fase-1-loop-buzz
# docs
git -C . push backup fase-0-auditoria
```

Depois, abrir PR de `fase-1-loop-buzz` no seu fork (ou release), citando este documento.

## Serviços (self-hosted, grátis)

- **Buzz relay** + postgres/redis/minio: `deploy/compose` do Buzz (imagem `ghcr.io/block/buzz`).
- **Qdrant**: `docker run qdrant/qdrant`.
- **Acesso mobile:** kit `docs/deploy/buzz-mobile-tls/` (Caddy+TLS grátis). Aponte um domínio,
  registre a comunidade sob esse host e conecte o app em `wss://SEU_DOMINIO`. Local = $0.

## Fase 2 — PRONTO PARA USO (endpoints REST + flags + prova ao vivo)

Os cores não são só biblioteca: estão **chamáveis** e provados num servidor rodando (evidência em
`docs/evidence/r4/LIVE_ENDPOINTS.md`). Flags no painel único: `MCP_REVIEW_ENABLED`,
`BROWSER_USE_ENABLED`, `OTEL_TRACING_ENABLED` (+ Loop/Buzz já existentes).

- `POST /api/mcp/review` — verdict do MCP Review Gate (review_required / denied / approved).
- `POST /api/browser/check` — decisão do Browser Guard (deny p/ efeito na página; require_approval).
- `GET /api/loop/{id}/stream` — **AG-UI via SSE** (consumível por `EventSource`).
- `GET /api/otel/spans` — spans W3C sem conteúdo sensível.
  Todos exigem management auth + a flag (OFF → 404); provados ao vivo com login real.

## Fase 2 — cores determinísticos (código decide, testados)

Entregues como **cores puros, aditivos e testados** (padrão do Loop/Buzz: código decide, não a IA;
o driver/serviço externo os consome quando houver wiring). **63 testes** no total das superpowers.

- **PII BR** (`src/lib/piiSanitizer.ts`): + **CEP** e **chave PIX** (UUID, context-gated). CPF/CNPJ/
  telefone-BR já existiam. Presidio-like, determinístico, self-hosted.
- **MCP Review Gate** (`open-sse/mcp-review`): pipeline descobrir→quarentena→revisar→aprovar;
  malicioso/proibido → denied; **ampliar permissão volta a review_required**.
- **Browser Guard** (`open-sse/browser-guard`): OFF por padrão, allowlist de domínio, efeito externo
  exige aprovação humana; **efeito externo originado na página → deny** (prompt injection não escala).
- **AG-UI** (`open-sse/ag-ui`): contrato de eventos agente→UI + encoder SSE + validação de sequência.
- **OTel-lite** (`open-sse/otel`): W3C Trace Context + spans **sem conteúdo sensível** (allowlist).
- **Buzz tenant_id + wiring**: tabelas nascem com `tenant_id` (isolamento real); **produtor** (Loop
  escala → aviso durável no outbox) e **consumidor** (subscribe→inbox, storage-only) ligados.

## Limitações conhecidas (auditadas — 0 CRITICAL / 0 HIGH)

Três auditorias independentes (Arquitetura, Segurança, Produto/QA) em `audit/FINAL_THREE_AGENT_REVIEW.md`.
Correções de causa-raiz aplicadas (teto de tentativas do Loop; idempotência de publish do Buzz; i18n/a11y;
tratamento de erro; deep-link; **tenant_id**; **produtor/consumidor**). Ainda **a endereçar antes de
ligar a flag Buzz em produção exposta** (hoje inerte, flag OFF): relayUrl admin-only/local por design
(sem allowlist de host); flush sem lock/requeue; `MAX(seq)+1` não atômico (SQLite síncrono). Os cores da
Fase 2 (Browser/OTel/MCP/AG-UI) sobem atrás das respectivas flags quando ligados ao driver/UI real.
