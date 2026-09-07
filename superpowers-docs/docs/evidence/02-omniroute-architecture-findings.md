# Evidência — Achados arquiteturais do OmniRoute (SHA f9a1cc8)

## OmniRoute já expõe as duas superfícies de API pedidas

- `src/app/api/v1/messages/route.ts` — endpoint **Anthropic-compatible** (`/v1/messages`).
  Comentário no código cita explicitamente "Streaming Anthropic clients (**Claude Code**,
  the Anthropic SDK)"; usa translators, prompt-injection guard, admission control e
  keepalive/ping (ANTHROPIC_PING_FRAME). Também há `/v1/messages/count_tokens`.
- `src/app/api/v1/responses/` — endpoint **OpenAI Responses** (`/v1/responses`).
- Também: `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models` (via catch-all), etc.
- Porta padrão do gateway: **20128** (bate com o plano 127.0.0.1:20128).
- Engines: Node `>=22.22.2 <23 || >=24.0.0 <27` → **Node 24.16 compatível** (sem conflito).

CONCLUSÃO: o requisito adicionado (interface Anthropic `/v1/messages` para o Claude Code)
**já é atendido nativamente**. Trabalho vira verificar/rotear, não construir do zero.

## OmniRoute JÁ integra o codex-chatgpt-web como provider interno

Presentes no commit congelado:

- `open-sse/vendor/codex-chatgpt-web/` — código do codex-chatgpt-web **já vendorizado**
  (bridge.ts, browser-login.ts, chatgpt-session.ts, process.ts, event-queue.ts,
  launcher-browser-host.ts, stall-timeout.ts, responses/{parser,state,schema,compaction},
  adapters/chatgpt-web, usage, version.ts).
- Providers: `registry/chatgpt-web`, `registry/chatgpt-web-codex`, `registry/codex`,
  `registry/codex-app-server`.
- Executores: `executors/chatgpt-web-codex/{credentials,doctor,models,runtime,storageState,tunnelClient}.ts`,
  `executors/codex`.
- Bridge/health/auth: `src/app/api/internal/codex-responses-ws`,
  `src/app/api/providers/[id]/chatgpt-web-codex-doctor`, `src/app/api/oauth/codex`,
  `src/app/api/providers/codex-auth`, `open-sse/services/codexAccount`.
- ~36 arquivos de teste em `tests/unit` referenciam chatgpt-web.

CONCLUSÃO: boa parte das Fases 1–3 (contratos de provider, adaptador ChatGPT Web,
streaming/cancelamento, erros tipados, health/readiness) **já existe no upstream**.

## Gap de versão (incompatibilidade a tratar)

- Vendor em OmniRoute: **codex-chatgpt-web v4.0.7** (commit b59d7dc5), MIT, atribuído em
  `THIRD_PARTY_NOTICES.md`.
- Base congelada pelo plano: **v5.0.4** (commit c648c095).
- Delta v4.0.7 → v5.0.4 exige re-auditoria/testes/comparação de segurança (§2 do plano)
  antes de adotar a base mais nova. Decisão de escopo para o pós-gate.
