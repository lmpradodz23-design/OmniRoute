# Fontes externas — o que agrega ao OmniRoute (curadoria)

> Avaliação de repositórios candidatos. Regra: só agrega o que estende o OmniRoute como
> **gateway universal + backend de agentes**, sem duplicar o que ele já tem e sem quebrar
> compatibilidade. ⚠️ Vários números de estrelas na lista original pareciam inflados —
> confirmar antes de confiar.

## Agrega valor direto (integrar ou minerar)

| Repo                             | Como agrega                                                                                                                                                                                                                     | Prioridade                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **decolua/9router**              | Gateway irmão; o OmniRoute **já porta patches dele** (`decolua/9router#336` no código). Minerar auto-fallback e truques de free-providers. _(OmniRoute já tem RTK/compressão — não duplicar.)_                                  | Alta (ideias/patches)       |
| **BerriAI/litellm**              | Gateway maduro — referência de guardrails, cost-tracking, load-balancing; possível backend de fallback.                                                                                                                         | Média (referência)          |
| **0x4m4/hexstrike-ai**           | Servidor **MCP** com 150+ ferramentas de segurança — candidato ao **MCP Marketplace** (com quarentena/aprovação).                                                                                                               | Média-alta (ferramenta MCP) |
| **agentconnect-md/agentconnect** | Colaboração multi-agente. **DECISÃO: fica o Buzz.** Motivo do operador: com o Buzz (Nostr) dá para **falar com os agentes pelo app de celular** (qualquer cliente Nostr mobile), o que facilita muito. agentconnect descartado. | Decidido: Buzz              |

## Harnesses-alvo (servir bem, não integrar dentro)

- **NousResearch/hermes-agent** (Hermes), **deepseek-harness**, **cline/cline** — são harnesses.
  Valor = OmniRoute ser backend excelente (contratos OpenAI/Anthropic/Ollama já existem).

## Skills/plugins (capacidades para agentes)

- **obra/superpowers** (framework de skills), **nexu-io/open-design** e
  **nextlevelbuilder/ui-ux-pro-max-skill** (design), **gadievron/raptor** (segurança).
  Entram como **skills** (o OmniRoute já tem `agent-skills`), não como parte do gateway.

## Não agrega (produto/domínio diferente)

- **harness/harness** — CI/CD DevOps (Go), **colisão de nome**, não é harness de IA.
- **odoo** (ERP — projeto DZ23-CRM), **monica** (CRM), **minimind** (treinar LLM),
  **bolt.diy / Open-Laudable** (construtores de app), **py-gpt / Osmantic/ODS / voicebox**
  (apps desktop/voz — _usariam_ o OmniRoute), **TauricResearch/TradingAgents**,
  **Secretaria WhatsApp/n8n**, **opensquad** (sem descrição).

## Já integrado

- **miuuyy/codex-chatgpt-web** — vendorizado na R3-A (provider ChatGPT Web/Codex v4.0.7).

## Roteiro de aproveitamento (quando fizer sentido/houver disco)

1. Auditar **9router** para auto-fallback/free-providers (aditivo).
2. **hexstrike-ai** como ferramenta no MCP Marketplace.
3. Decisão colaboração: **agentconnect vs Buzz**.
4. **litellm** como referência de guardrails/cost.
