# Receitas de conexão — plugue qualquer harness no OmniRoute

> O OmniRoute é o backend universal: qualquer cliente (IDE, terminal, agente) aponta para
> ele por **padrão aberto** (OpenAI / Anthropic / Ollama) e ganha 352 provedores, fallback,
> free-tier, roteamento `auto`, budgets e segurança — **sem trocar de ferramenta**.

## Base (vale para todos)

- **Base URL (OpenAI):** `http://localhost:20128/v1`
- **Base URL (Anthropic):** `http://localhost:20128` (endpoint `/v1/messages`)
- **Base URL (Ollama):** `http://localhost:20128`
- **API Key:** crie uma no painel do OmniRoute (Chaves de API). Use por harness (com budget/allowlist próprios).
- **Model:** `auto` (o OmniRoute escolhe o melhor/mais barato) ou um id específico (ex.: `pol/mistral`, `cgpt-web/gpt-5-6`).

---

## Continue (`continuedev/continue`) — VS Code / JetBrains

`~/.continue/config.json` (ou config.yaml):

```json
{
  "models": [
    {
      "title": "OmniRoute Auto",
      "provider": "openai",
      "model": "auto",
      "apiKey": "sk-SEU_TOKEN",
      "apiBase": "http://localhost:20128/v1"
    }
  ],
  "tabAutocompleteModel": {
    "title": "OmniRoute Fast",
    "provider": "openai",
    "model": "auto",
    "apiKey": "sk-SEU_TOKEN",
    "apiBase": "http://localhost:20128/v1"
  }
}
```

Chat no código + autocomplete usando sempre a API mais rápida/com cota.

## Cline (`cline/cline`) — agente autônomo no editor

Settings do Cline → **API Provider: OpenAI Compatible**:

- Base URL: `http://localhost:20128/v1`
- API Key: `sk-SEU_TOKEN` · Model: `auto`

> O diferencial: numa refatoração longa, se a cota do modelo acabar, o OmniRoute faz
> **fallback automático** para outra conta/provider — o agente **não para** por "falta de crédito".

## Aider (`paul-gauthier/aider`) — terminal + Git

```bash
export OPENAI_API_BASE="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-SEU_TOKEN"
aider --model auto
```

Agilidade no terminal; o roteador cuida para as requisições não falharem.

## OmniCopilot (`diegosouzapw/omnicopilot`) — motor por baixo do GitHub Copilot Chat

Extensão nativa do autor do OmniRoute: substitui o motor do Copilot Chat no VS Code, dando
aos atalhos/painel do Copilot acesso aos 352 provedores do seu OmniRoute (imagens + tools).
Instale a extensão e aponte-a para `http://localhost:20128` (endpoint Copilot do OmniRoute:
`/v1/vscode/...`, já existente).

## Claude Code (Anthropic) — via `/v1/messages`

```bash
export ANTHROPIC_BASE_URL="http://localhost:20128"
export ANTHROPIC_API_KEY="sk-SEU_TOKEN"
# use o Claude Code normalmente; ele fala /v1/messages
```

## Codex (OpenAI) — via `/v1/responses`

Aponte a base do Codex para `http://localhost:20128/v1` (ele usa `/v1/responses`). Para o
ChatGPT Web nativo, use os modelos `cgpt-web/*` (requer conexão chatgpt-web no painel).

## Hermes (`NousResearch/hermes-agent`) e demais

Qualquer agente que aceite base URL OpenAI/Anthropic/Ollama: aponte para as bases acima com
`model: auto`. Nada específico por-harness — é o mesmo padrão aberto para todos.

---

## Dica: um perfil por harness (no painel único)

Crie **uma chave por harness** (continue, cline, aider, hermes…) com allowlist de modelos,
budget de custo/tokens e `no-log` próprios. Assim você controla cada ferramenta em um só lugar.
