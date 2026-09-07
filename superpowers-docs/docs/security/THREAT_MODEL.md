# Threat Model inicial — OmniRoute Unified (Fase 0)

- **Data:** 2026-09-06 · **Escopo:** baseline/auditoria (nada em produção)
- **Base normativa:** §6 do plano + `CLAUDE.md` do projeto

## 1. Ativos protegidos

- Credenciais/segredos de provedores (API keys, tokens), **cookies/sessões** do ChatGPT
  Web/Claude/Codex.
- Config do Codex do usuário (não deve ser alterada sem backup).
- Conteúdo de prompts/respostas e **documentos** ingeridos (podem conter PII).
- Estado durável de tarefas/checkpoints (Postgres/SQLite), artefatos (MinIO), índice
  semântico (Qdrant).
- Trilha de auditoria imutável.

## 2. Processos e fronteiras de confiança (texto)

```
[Codex/Claude/IDEs] --loopback--> [OmniRoute Control Plane :20128 /v1/*]
   confiável (cliente local)            |  (dono da config; único endpoint)
                                        +--> Provider ChatGPT Web (PROCESSO FILHO)
                                        |      loopback + porta dinâmica + capability token
                                        |      partição de navegador isolada por conta
                                        +--> Outros provedores de IA (rede externa)  <== fronteira
                                        +--> Security Shield (Presidio, serviço isolado)
                                        +--> Knowledge Hub (worker Python sandbox)    <== dado não confiável
                                        +--> MCP Marketplace (Registry read-only + MCPs)  <== código de terceiros
                                        +--> Browser Automation (Browser Use, sandbox)  <== alto impacto
                                        +--> Observability (OTel Collector, redigido)
```

**Zonas:** (a) cliente local confiável; (b) plano de controle; (c) processo filho
supervisionado (semi-confiável); (d) **conteúdo não confiável** (documentos, páginas,
servidores MCP, saídas de provedores) — sempre dado, nunca instrução; (e) rede externa.

## 3. Ameaças por área e controles (STRIDE resumido)

| #   | Ameaça                        | Vetor                                                            | Controle exigido (§6)                                                                             |
| --- | ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| T1  | Vazamento de segredo          | log/memória/prompt/telemetria/bundle                             | Vault do SO; redaction antes de log/memória/telemetria; secret scan (§6.2,6.6,6.11)               |
| T2  | Exposição de cookie/sessão    | reuso entre ChatGPT/Claude/Codex                                 | Partições isoladas por conta/provedor; nunca copiar cookies (§6.3)                                |
| T3  | SSRF                          | endpoint interno + "localhost liberado"                          | Sem SSRF global p/ localhost; registrar só o endpoint provisionado; porta dinâmica + token (§6.5) |
| T4  | Prompt injection              | documento/página/MCP instruindo o sistema                        | Conteúdo ingerido = dado; guard de injeção (já há `promptInjectionGuard` no /v1/messages) (§6.17) |
| T5  | PII para fora                 | prompt/documento antes de provedor/Qdrant/MCP/browser/telemetria | Pipeline Security Shield block/mask/tokenize/allow-with-audit; fail-closed (§6.6,6.15)            |
| T6  | Documento malicioso           | ZIP bomb, macro, MIME falso, path traversal, recursão            | Worker isolado, sem credenciais, limites CPU/mem/tamanho/tempo (§6.14)                            |
| T7  | MCP malicioso                 | pacote com segredo embutido/permissão não declarada              | Quarentena, checksum, licença, análise estática, aprovação; permissões mínimas revogáveis (§6.13) |
| T8  | Ação irreversível via browser | compra/envio/publicação/exclusão/aceite                          | Aprovação humana explícita + allowlist de domínio (§6.16)                                         |
| T9  | Fallback silencioso           | falha do ChatGPT Web mascarada                                   | Fallback explícito e auditado; falha aparece como erro tipado (§ADR-001.6)                        |
| T10 | Escalonamento cross-tenant    | consulta a memória/índice sem filtro                             | `tenant_id` + ACL obrigatórios em toda consulta a Qdrant/tabelas (§6.7,6.8)                       |
| T11 | Perda/sobrescrita de código   | dois escritores no mesmo worktree                                | Um writer-lease por tarefa/worktree; worktrees separados (§5.3)                                   |
| T12 | Telemetria vazando conteúdo   | atributos novos exportados sem revisão                           | OTel allowlist-based; sem prompt/resposta/doc/segredo (§6.18)                                     |

## 4. Riscos específicos da Fase 0 (baseline)

- **Disco C: ~96% cheio** — risco operacional (não de segurança): mitigado por economia de disco.
- **Bun quebrado / Python 3.14** — reparo/pin isolados, sem alterar instalações do usuário.
- **`.env` reais na máquina** — auditor NÃO lê `.env` com chaves; usa apenas `.env.example`.
- **Gap de versão v4.0.7→v5.0.4** — adotar upstream mais novo sem re-auditoria seria risco;
  fica bloqueado até decisão de escopo.

## 5. Pendências de threat model (fases seguintes)

- Diagrama formal de sequência do handoff Claude↔Codex e do lease.
- Modelagem detalhada do sandbox do MarkItDown e do perfil isolado do Browser Use.
- Testes adversariais: CSRF/SSRF/XSS/CORS/IDOR/path traversal/prompt injection/isolamento (Fase 8).
