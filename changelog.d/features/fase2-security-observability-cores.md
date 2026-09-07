- **feat(agentic/security):** cores determinísticos das fases seguintes, aditivos e testados
  (código decide, não a IA): reconhecedores **PII BR** (CEP, chave PIX) no sanitizer; **MCP Review
  Gate** (descobrir→quarentena→revisar→aprovar; ampliar permissão volta a review_required; malicioso
  → denied); **Browser Guard** (OFF por padrão, allowlist de domínio, aprovação humana p/ efeito
  externo, efeito originado na página → deny contra prompt injection); **AG-UI** (contrato de eventos
  agente→UI + encoder SSE + validação de sequência); **OTel-lite** (W3C Trace Context + spans sem
  conteúdo sensível via allowlist). Além disso, **Loop/Buzz** ganharam `tenant_id` (isolamento por
  tenant) e o **produtor/consumidor** do Buzz (Loop escala → aviso durável no outbox; subscribe→inbox
  storage-only — a chave Nostr nunca autoriza ação). 63 testes verdes; `typecheck:core` = 0.
