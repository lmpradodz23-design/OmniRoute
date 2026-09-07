# OmniRoute Unified — Integração universal de harnesses (roadmap vivo)

> **Objetivo:** ser o backend **universal** (qualquer harness que integra o OmniRoute) e o
> **mais completo** para agentes, programação e IA em geral. Guiado por dois princípios de
> memória: _harness-agnóstico_ e _painel único_.

## 0. Princípios inegociáveis

1. **Padrões abertos, nunca hacks por-harness.** Tudo via OpenAI/Anthropic/Gemini/Ollama/MCP.
   Assim **qualquer** harness (Claude Code, Codex, Hermes, Cline, Cursor, Aider, OpenCode, …) funciona.
2. **Aditivo e sem regressão** (mesma disciplina da R3-A). Nada que já funciona pode quebrar.
3. **Painel único.** Toda configuração no dashboard do OmniRoute — sem UIs separadas por componente.
4. **OmniRoute é o plano de controle.** Segurança/políticas/aprovações são dele; serviços
   externos (Buzz, etc.) são fontes de verdade só do seu domínio.

## 1. Camada de protocolo universal (o que os harnesses falam)

| Contrato                                                               | Status                     | Serve a                    |
| ---------------------------------------------------------------------- | -------------------------- | -------------------------- |
| OpenAI `/v1/chat/completions`                                          | ✅                         | quase todos                |
| OpenAI `/v1/responses`                                                 | ✅                         | Codex, agentes novos       |
| Anthropic `/v1/messages` (+ `count_tokens`)                            | ✅                         | Claude Code                |
| Google Gemini `generateContent`                                        | ➕ a completar             | harness Google             |
| **Ollama-compat** (`/api/chat`, `/api/tags`)                           | ➕                         | muitos IDEs/harness locais |
| Embeddings `/v1/embeddings`                                            | ✅ (checar paridade)       | RAG/memória                |
| **Streaming SSE** com deltas de **tool-call** e **reasoning/thinking** | ➕ paridade nos 3 formatos | agentes                    |
| **Tool/function calling** normalizado entre provedores                 | ➕                         | todos                      |
| **Prompt caching** passthrough (`cache_control`)                       | ➕                         | Claude Code/Codex          |
| **Reasoning effort** (low/medium/high/xhigh) mapeado                   | ✅ base                    | agentes de código          |

## 2. Perfil por harness (no painel único)

- **Chave por harness** com allowlist de modelos, **budget de custo/tokens**, rate-limit e `no-log`.
- **Roteamento por alias/perfil**: harness manda `model:"auto"` (ou um alias) e o OmniRoute
  escolhe o melhor/mais barato para a tarefa.
- **`/v1/models` com capacidades reais** (vision, tools, reasoning, janela, custo) para o harness escolher.

## 3. Capacidades de AGENTE (o que torna um bom agente)

- **MCP Marketplace** — a mesma caixa de ferramentas MCP curada para todos os harnesses
  (descobrir→quarentena→verificar→aprovar→instalar→habilitar). Update que amplia permissão volta a REVIEW.
- **Memória/RAG (Qdrant + MarkItDown)** — memória compartilhada entre sessões e harnesses;
  ingestão de documentos; filtro por tenant/workspace/ACL.
- **Browser Use** — navegador como ferramenta, allowlist de domínio, aprovação para efeitos externos.
- **Handoff bidirecional entre harnesses** (§7) — continuar no Codex/Hermes o que começou no Claude Code.
- **Supervisor + capability token** — spawnar sub-agentes supervisionados (porta dinâmica + token),
  sem derrubar o gateway; backoff/circuit-breaker.
- **Loop Engine** (report-only) — ciclos de descoberta→plano→execução→verificação→budget→handoff.

## 4. Capacidades de PROGRAMAÇÃO

- **Roteamento para o melhor modelo de código** por tarefa; fallback automático.
- **Worktrees isolados** por tentativa (padrão do Loop); nunca dois escritores no mesmo worktree.
- **Verifier independente** (build/test) antes de aceitar mudança; report-only no início.
- **Contexto de repositório** via memória/RAG + MarkItDown (docs, ADRs, código).
- **Ferramentas de dev via MCP** (git, GitHub, filesystem, testes) padronizadas para todos.

## 5. Segurança (antes de qualquer provider)

- **Presidio (PII shield)** + reconhecedores BR (CPF/CNPJ/CEP/telefone/PIX): block/mask/tokenize/
  allow-with-audit **antes** de provider/Qdrant/MCP/Browser/telemetria.
- **Policy Engine determinístico** (código decide, não a IA) para todo efeito externo.
- **Secret scan / SBOM / dep audit**; redação de credenciais em logs/erros.

## 6. Observabilidade e operação

- **OpenTelemetry** sem conteúdo sensível — tracing de todo o tráfego dos harnesses num lugar.
- **Health/circuit-breaker por provider**, auto-fallback, quota/rate-limit por harness.
- **Cost tracking + orçamentos** por chave/harness.
- **Modelo local (Ollama/llama.cpp)** como fallback offline — resiliência sem internet.

## 7. Handoff entre harnesses (o diferencial)

- **Estado/memória compartilhados** no DB do OmniRoute (tasks, runs, checkpoints, aprovações).
- **Ponte idempotente** (outbox/inbox, `sequence_number`, `correlation_id`, `task_id`, `run_id`, dedup)
  — já implementada no `buzz-bridge` e no `loop-engine`.
- **Buzz Collaboration Hub** — sala humano+agente (Nostr), opcional; chave Nostr **nunca** autoriza no OmniRoute.

## 8. Painel único (dashboard do OmniRoute)

Seções na navegação existente (OMNIPROXY / AGENTIC FEATURES / CONFIGURATION): conexões dos
harnesses, roteamento/perfis, chaves+budgets, **MCP tools**, **memória/Qdrant**, **segurança/Presidio**,
**observabilidade**, **Loop**, **Buzz**. Um lugar configura tudo.

## 9. Roadmap priorizado (maior impacto primeiro)

1. **Perfil/chave por harness + roteamento por alias** (destrava qualquer harness já). _(aditivo, leve)_
2. **Paridade de protocolo**: Ollama-compat + Gemini + streaming de tool/reasoning nos 3 formatos.
3. **MCP Marketplace** (mesma toolbox para todos).
4. **Presidio (PII)** antes de todo provider.
5. **Memória compartilhada (Qdrant+MarkItDown)** → handoff real entre harnesses.
6. **Loop + Buzz** (núcleos prontos: `open-sse/loop-engine`, `open-sse/buzz-bridge`; falta wiring+UI+relay).
7. **Observabilidade (OTel)** + **modelo local** (resiliência).

> **Restrições atuais:** gate geral **NO-GO** até a Fase 0 (R3-A) verde. Serviços pesados
> (Qdrant, Presidio, Buzz-relay, Browser Use) exigem **disco** (build/containers) — hoje ~800 MB
> livres. Núcleos puros (Loop, Buzz-bridge) e camada de protocolo/roteamento são **viáveis já**.
