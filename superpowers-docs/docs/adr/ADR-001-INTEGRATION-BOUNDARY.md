# ADR-001 — Fronteira de Integração (OmniRoute Unified)

- **Status:** Aceito (Fase 0)
- **Data:** 2026-09-06
- **Contexto de referência:** `PLANO_EXECUCAO_OMNIROUTE_UNIFICADO_PARA_CLAUDE.md`
- **Commits congelados:** OmniRoute `f9a1cc8`, codex-chatgpt-web `c648c09` (v5.0.4)

## Contexto

A Fase 0 revelou que, no commit congelado, o **OmniRoute já é um produto maduro
(v3.8.51)** e **já integra o codex-chatgpt-web** como provider interno vendorizado
(`open-sse/vendor/codex-chatgpt-web/`, v4.0.7), com executor, bridge de responses,
doctor/health, fluxo de auth (`oauth/codex`) e ~36 testes. Além disso, o OmniRoute
**já expõe** as duas superfícies de API relevantes: `/v1/messages`
(Anthropic-compatible, citando Claude Code no próprio código) e `/v1/responses`
(OpenAI Responses). A porta padrão é **20128**.

Isso muda a natureza do trabalho: não é "integrar dois repos do zero", e sim
"**verificar, configurar, supervisionar e adicionar as camadas de produto ausentes**"
(supervisor de ciclo de vida, instalador/bandeja única, Knowledge Hub, MCP Marketplace,
Agent Console, Security Shield, observabilidade).

## Decisões

1. **OmniRoute é o repositório de produto e plano de controle único.** Não haverá
   reorganização estética do repo; a integração é modular sobre a estrutura existente.
2. **codex-chatgpt-web é consumido pelo mecanismo já existente e rastreável**
   (`open-sse/vendor/codex-chatgpt-web/` + adapters + executor), que preserva origem e
   atribuição (`THIRD_PARTY_NOTICES.md`). Não haverá copy/paste sem histórico. A
   incorporação por subtree/atualização auditável segue esse mesmo padrão.
3. **Contrato público do gateway = `/v1/responses` (OpenAI) + `/v1/messages` (Anthropic).**
   Ambos já existem no OmniRoute. O requisito adicional (Claude Code usar o OmniRoute como
   gateway via `/v1/messages`) é atendido nativamente; as fases seguintes apenas
   **verificam e roteiam** o provedor ChatGPT Web por esses endpoints.
4. **O provedor ChatGPT Web roda como processo filho supervisionado**, na primeira versão,
   mantendo o runtime do upstream. Comunicação restrita a **loopback + porta dinâmica +
   token de capacidade de curta duração** (padrão já sugerido pelo `tunnelClient`/bridge).
5. **O OmniRoute é o único dono da configuração do Codex.** O Codex aponta somente para o
   endpoint local do OmniRoute; o provedor interno não reescreve a config do Codex. (Na
   Fase 0 nada disso é alterado; a config atual do usuário permanece intocada.)
6. **Fallback é explícito e auditado.** Falha do ChatGPT Web nunca é mascarada por resposta
   silenciosa de outro provedor.
7. **Segredos** ficam em cofre do SO/vault; nunca em log, memória, prompt ou frontend.
   Cookies/sessões isolados por conta e provedor; nunca copiados entre ChatGPT/Claude/Codex.

## Incompatibilidades registradas (a tratar no pós-gate)

- **Gap de versão:** vendor = codex-chatgpt-web **v4.0.7**; base congelada = **v5.0.4**.
  Adotar a v5.0.4 exige re-auditoria/testes/comparação de segurança do delta (§2 do plano).
  → **Decisão de escopo** a confirmar com o aprovador antes de mexer no vendor.
- **Bun quebrado** na máquina → reparar para **1.4.0** (fixado pelo upstream), uso restrito
  ao módulo codex-chatgpt-web.
- **Python 3.14** é novo demais para Presidio/MarkItDown/Browser-Use → fixar **3.12** via `uv`.
- **MCP Registry** com licença **NOASSERTION** no GitHub → auditoria manual de licença antes de uso.

## Restrições de operação (Fase 0 e além)

- Isolamento total em `C:\Users\zodyp\Downloads\OmniRoute-Unified`; nenhuma escrita nas
  instalações vivas do usuário (`~/.omniroute`, `~/.codex`, `~/.codex-chatgpt-web`,
  `Documents/Codex/*`, `AppData/Roaming/Hermes*`).
- **Economia de disco** (C: ~96% cheio): partial clone, `git ls-remote`, `docker manifest
inspect`; `docker pull` só quando um gate exigir execução real.
- Componentes pesados (Qdrant, OTel Collector, Presidio) consumidos como **serviço Docker**
  com versões fixadas; MarkItDown/Browser-Use como **worker Python isolado** (uv/3.12);
  AG-UI como **biblioteca**; MCP Registry via **API versionada read-only**.

## Consequências

- Roadmap reordenado: Fases 1–2 passam a ser majoritariamente **verificação e
  configuração** do que já existe, liberando esforço para Fases 3–8 (supervisor,
  instalador único, Knowledge Hub, Marketplace, Console, Security Shield, observabilidade).
- Menor risco de integração inicial; maior foco em ciclo de vida, isolamento e segurança.
