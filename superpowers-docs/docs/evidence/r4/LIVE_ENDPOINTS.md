# Prova ao vivo — endpoints da Fase 2 (pronto para uso)

Servidor da branch `fase-1-loop-buzz` subido **isolado** (porta 20130, DATA_DIR próprio no scratchpad,
flags ON por env) — a instância do usuário (20129) não foi tocada e seguiu `health=200`. Autenticação
real via login do dashboard (cookie de sessão). Respostas verbatim:

## POST /api/mcp/review

- novo servidor com `fs:write` →
  `{"state":"review_required","requiresHumanApproval":true,"reasons":["servidor novo…","declara permissões sensíveis"]}`
- pacote malicioso (`secrets:exfiltrate`) → `{"state":"denied","reasons":["permissões proibidas: secrets:exfiltrate"]}`
- update que amplia (`shell:exec`) sobre prior aprovado → `{"state":"review_required","newlyRequested":["shell:exec"]}`

## POST /api/browser/check

- `purchase` originada na **página** → `{"decision":"deny","reason":"efeito externo originado na página (possível prompt injection)…"}`
- `submit` do **usuário** em domínio permitido → `{"decision":"require_approval","reason":"efeito externo (submit) requer aprovação humana"}`

## GET /api/loop/{id}/stream (AG-UI, SSE)

`Content-Type: text/event-stream`; fluxo válido:

```
event: RUN_STARTED    data: {"seq":0,...}
event: STATE_SNAPSHOT data: {"seq":1,...,"state":{"phase":"discover","status":"report_only",...}}
event: RUN_FINISHED   data: {"seq":2,...}
```

## GET /api/otel/spans

Spans W3C coletados, **só atributos allowlisted** (sem prompt/PII/segredo):

```
{"traceId":"d3ca8249…","spanId":"1a9deca2…","name":"mcp.review","status":"ok",
 "attributes":{"route":"/api/mcp/review","provider":"mcp"},"startMs":…,"endMs":…}
```

## Auth

`GET /api/loop` sem sessão → **401** (auth exigida, correto). Após login → **200**. Todos os
endpoints acima exigem management auth + a respectiva flag (OFF → 404).
