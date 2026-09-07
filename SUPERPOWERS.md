# O que este fork adiciona ao OmniRoute (e por que ele é diferente)

O **OmniRoute** base é um gateway de IA gratuito: um endpoint → 352 provedores, fallback, compressão,
free-tier. **Este fork mantém 100% disso** e adiciona uma camada **agêntica + colaboração + segurança +
observabilidade** — tudo **aditivo, atrás de feature flags OFF por padrão, sem regressão**, e com uma
regra de ouro: **o código decide, não a IA** (política determinística; nada de efeito externo sem
aprovação humana).

> Base verde MIT `c0b2253`. Branch: `fase-1-loop-buzz`. Certificação: **67/67 testes**, `typecheck:core`=0,
> 3 auditorias independentes (0 CRITICAL / 0 HIGH), endpoints provados **ao vivo**.

## O que este fork tem de melhor (explícito) — original vs este fork

| Capacidade                                                                      |     OmniRoute original      |                                            **Este fork**                                             |
| ------------------------------------------------------------------------------- | :-------------------------: | :--------------------------------------------------------------------------------------------------: |
| Gateway: 352 provedores, fallback, compressão, free-tier, roteamento            |             ✅              |                                        ✅ **(mantido 100%)**                                         |
| **Loop Engine** — ciclos agênticos report-only com budget e policy gate         |             ❌              |                                             ✅ **novo**                                              |
| **Buzz Hub** — falar com os agentes **pelo celular** (Nostr, self-hosted)       |             ❌              |                                             ✅ **novo**                                              |
| **Isolamento multi-tenant** (`tenant_id`) nas tabelas agênticas                 |             ❌              |                                             ✅ **novo**                                              |
| **PII brasileira**                                                              | parcial (CPF/CNPJ/telefone) |                                  ✅ **completo (+CEP, +chave PIX)**                                  |
| **Marketplace MCP**                                                             | básico (instalar/checksum)  | ✅ **+ gate de revisão de segurança** (quarentena; ampliar permissão → re-revisão; malicioso → nega) |
| **Browser Use guardado** — allowlist + aprovação humana + anti prompt-injection |             ❌              |                                             ✅ **novo**                                              |
| **AG-UI** — console de agente por eventos (SSE, replay/reconexão)               |             ❌              |                                             ✅ **novo**                                              |
| **OTel** — tracing W3C **sem vazar conteúdo** (allowlist)                       |             ❌              |                                             ✅ **novo**                                              |
| **Política determinística** (código decide, humano no efeito externo)           |             ❌              |                                             ✅ **novo**                                              |
| Endpoints REST novos gated por flag                                             |              —              |        `/api/loop*`, `/api/buzz*`, `/api/mcp/review`, `/api/browser/check`, `/api/otel/spans`        |

> Memória vetorial (Qdrant) e o painel único já existem no base — este fork **os reaproveita**,
> não os reivindica como novidade. Tudo que é novo entra **atrás de flag OFF por padrão**.

## Resumo em uma linha

Onde o OmniRoute base **serve modelos**, este fork faz o OmniRoute também **orquestrar trabalho agêntico
com segurança**, **falar com humanos pelo celular**, **proteger PII BR**, **revisar MCPs**, **guardar a
automação de navegador** e **observar** — sem perder nada do gateway.

## O que muda, por quê e como usar

### 1. Loop Engine — ciclos agênticos _report-only_

- **O quê:** um motor de ciclo (discover→plan→split→execute→checkpoint→verify→budget→escalate) com
  **budget** (estourou → aborta) e **policy gate determinístico**: efeito destrutivo = `deny`, sensível =
  `require_approval`. Nada roda sem aprovação humana.
- **Por quê:** dá ao gateway um laço de automação **seguro e auditável** — o modelo propõe, o código decide.
- **Usar:** flag `LOOP_ENGINE_ENABLED`; REST `/api/loop` (listar/iniciar/avançar/aprovar); página `/dashboard/loop`.

### 2. Buzz Hub — colaboração humano+agente por Nostr (celular)

- **O quê:** ponte para um **relay Nostr self-hosted** (auth NIP-42, outbox/inbox idempotente). O Loop
  escala → **aviso durável no outbox** que você recebe **no app do celular**. `tenant_id` isola por tenant.
- **Por quê:** você conversa com os agentes **de qualquer lugar**, sem interface presa ao servidor.
- **Segurança:** **uma chave Nostr NUNCA autoriza** uma ação no OmniRoute — mensagem é sinal, não comando.
- **Usar:** flag `BUZZ_HUB_ENABLED`; `/api/buzz`, `/dashboard/buzz`; kit mobile Caddy+TLS grátis.

### 3. PII BR — reconhecedores brasileiros

- **O quê:** o sanitizer ganha **CEP** e **chave PIX** (além de CPF/CNPJ/telefone-BR já existentes).
- **Por quê:** proteção de dados pessoais **brasileiros** antes de sair para provedor/telemetria.
- **Usar:** flag existente `PII_RESPONSE_SANITIZATION`.

### 4. MCP Review Gate — marketplace com segurança

- **O quê:** pipeline determinístico descobrir→quarentena→revisar→aprovar. Malicioso/permissão proibida →
  `denied`; **ampliar permissão volta a `review_required`** (re-revisão humana).
- **Por quê:** instalar servidores MCP sem virar porta de entrada de supply-chain.
- **Usar:** flag `MCP_REVIEW_ENABLED`; `POST /api/mcp/review`.

### 5. Browser Guard — automação de navegador contida

- **O quê:** OFF por padrão, **allowlist de domínio**, **aprovação humana** para efeito externo, e —
  contra prompt injection — **efeito externo originado na página é negado** (não escala permissão).
- **Por quê:** usar o navegador sem que uma página maliciosa comande compras/uploads.
- **Usar:** flag `BROWSER_USE_ENABLED`; `POST /api/browser/check`.

### 6. AG-UI — console de agente por eventos (SSE)

- **O quê:** contrato de eventos agente→UI (run lifecycle, deltas de texto, tool calls, estado) com
  encoder SSE e validação de sequência (replay/reconexão).
- **Usar:** flag `LOOP_ENGINE_ENABLED`; `GET /api/loop/{id}/stream` (consumível por `EventSource`).

### 7. OTel-lite — observabilidade sem vazar conteúdo

- **O quê:** W3C Trace Context + spans com **atributos allowlisted** — prompt/resposta/PII/segredo
  **nunca** entram na telemetria.
- **Usar:** flag `OTEL_TRACING_ENABLED`; `GET /api/otel/spans`.

## Princípios (por que confiar)

- **Aditivo:** nada do gateway original foi removido ou alterado no caminho crítico.
- **Flags OFF por padrão:** liga só o que quiser, quando quiser, no **painel único**.
- **Código decide:** políticas determinísticas; a IA propõe, o código aprova/nega; humano no efeito externo.
- **Sem verde artificial:** cada correção tem teste que falharia sem ela; 3 auditorias independentes.
- **Grátis/self-hosted:** relay Buzz, Qdrant, Caddy/TLS — $0.

## Onde ver mais (tudo neste mesmo repositório)

- Release e certificação: [`superpowers-docs/docs/RELEASE_SUPERPOWERS.md`](./superpowers-docs/docs/RELEASE_SUPERPOWERS.md)
- Receitas por harness: [`superpowers-docs/docs/HARNESS_RECIPES.md`](./superpowers-docs/docs/HARNESS_RECIPES.md)
- Auditoria independente (0 CRIT/0 HIGH): [`superpowers-docs/audit/FINAL_THREE_AGENT_REVIEW.md`](./superpowers-docs/audit/FINAL_THREE_AGENT_REVIEW.md)
- Prova ao vivo dos endpoints: [`superpowers-docs/docs/evidence/r4/LIVE_ENDPOINTS.md`](./superpowers-docs/docs/evidence/r4/LIVE_ENDPOINTS.md)
- Kit de acesso mobile (Caddy+TLS): [`superpowers-docs/docs/deploy/buzz-mobile-tls/`](./superpowers-docs/docs/deploy/buzz-mobile-tls/)
- PR: <https://github.com/lmpradodz23-design/OmniRoute/pull/1>
