# Fase 2 (MCP review, Browser Guard, AG-UI, OTel, PII BR) — revisão independente

Branch `feat/fase2-on-v3851`, transplante seletivo de `superpowers-on-v3.8.51` sobre
`release/v3.8.51`. Um auditor ofensivo, sem autorização de escrita, com instrução explícita de
atacar as afirmações que os próprios módulos fazem sobre si.

**Veredito inicial: REPROVADO.** Todos os achados corrigidos na causa raiz, cada um com teste de
regressão que reproduz a entrada usada pela auditoria.

## 1. Por que o transplante foi seletivo

A branch de origem carregava três coisas misturadas. Só 18 arquivos eram genuinamente novos; os
outros 43 eram o Loop/Buzz **pré-auditoria**, já superado pelo que o PR #8 mesclou. Além disso ela
**revertia** trabalho que já está na linha de release:

| O que a branch fazia                                                 | Por que ficou de fora                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `package.json`: `author` e `repository.url` de volta para o upstream | desfaz a identidade deste fork (fase 8 da missão 1)        |
| `package.json`: `hono` de `^4.13.7` para `^4.12.34`                  | rebaixa uma dependência já atualizada                      |
| `package.json`: remove `check:standalone-*`, `test:compat*`          | apaga gates e suítes existentes                            |
| `OAuthModalPanels.tsx`: link de ajuda para `diegosouzapw/OmniRoute`  | mesma reversão de identidade                               |
| `open-sse/buzz-bridge/outbox.ts`                                     | outbox em memória, órfão, superado pelo repositório SQLite |
| `migrations/174_loop_engine_and_buzz_bridge.sql`                     | número colide com a 175 publicada                          |

## 2. Achados e correções

### HIGH

**H1 — o Browser Guard não negava efeito externo originado na página.** A classificação era pelo
`kind` declarado, e `click`/`type` não estavam em `EXTERNAL_EFFECT_KINDS`. Reprodução no handler
real, flag ON:

```
POST /api/browser/check
{"action":{"kind":"click","origin":"page","url":"https://example.com/confirm-purchase"},
 "allowedDomains":["example.com"]}
-> {"verdict":{"decision":"allow","reason":"ação de leitura/navegação em domínio permitido"}}
```

Clicar num botão "Confirmar compra" é um `click`. A frase do módulo e do feature flag —
"page-originated external effects are denied (prompt injection cannot escalate)" — não se
sustentava. **Correção:** origem `page` só permite `read`; qualquer outra coisa que o conteúdo da
página peça é negada antes da allowlist, porque o guarda não sabe o que há do outro lado de um
clique.

**H2 — sem `url`, a allowlist inteira era pulada, e allowlist vazia permitia.** `{"kind":"click",
"origin":"page"}` sem URL e sem domínios devolvia `allow`; o estado padrão do produto respondia
permitido. **Correção:** toda ação que alcança a rede exige `url` e é negada sem ela — não
conseguir decidir tem que significar deny.

**H3 — o gate de MCP acreditava no chamador sobre a própria aprovação.** `prior.approved` chegava
no corpo e nada o amarrava a um registro; nem o `name` era comparado.

```
{"candidate":{"name":"evil-mcp","permissions":["shell:exec","process:spawn","fs:delete","secrets:read"],...},
 "prior":{"permissions":[...iguais...],"approved":true}}
-> {"state":"approved","requiresHumanApproval":false}
```

Além disso `FORBIDDEN_MCP_PERMISSIONS` casava por string exata, e o formato aceito na fronteira
admite maiúsculas: `KEYS:READ` e `Secrets:Exfiltrate` atravessavam e chegavam a `approved`.
**Correção:** a rota não aceita mais `prior` — aprovação anterior é estado do servidor, não existe
loja de aprovações ainda, então todo candidato é avaliado como novo (fail-closed); e as permissões
são comparadas normalizadas (`trim().toLowerCase()`), o que também conserta a detecção de ampliação
e o aviso de permissão sensível que o revisor humano não recebia.

### MEDIUM

**M4 — o reconhecedor de CEP corrompia saída.** `NNNNN-NNN` mordia o miolo de identificadores
hifenizados: `Pedido 12345-678`, `Rastreio 90210-123`, `build 20250-912`, `id ABC-12345-678-X`,
`isbn 03064-063`, `faixa 10000-500` — todos redigidos. Como `sanitizePIIResponse` percorre a
resposta inteira do modelo, isso era corrupção silenciosa de saída, não proteção de PII.
**Correção:** exige a pista "cep" por perto, como o PIX já fazia.

**M5 — o reconhecedor de PIX perdia chaves.** A pista precisava estar até 30 caracteres **antes** e
não cruzava quebra de linha, então `"<uuid> é a minha chave pix"`, `"Chave pix para transferir o
valor combinado ontem: <uuid>"` e `"chave Pix\n<uuid>"` passavam intactos. Falso negativo é a
direção que importa. **Correção:** a pista conta dos dois lados, dentro de 80 caracteres, e
atravessa linha.

**M6 — o nome do span escapava da allowlist.** Só `attributes` eram governados;
`startSpan(nome_de_1_000_000_chars)` era retido inteiro no ring buffer. **Correção:** nome sem
caracteres de controle e limitado a 120.

**M7 — `publisherVerified` ausente contava como verificado.** Só `=== false` forçava re-revisão,
então um candidato cuja verificação nunca rodou era auto-aprovado pelo valor padrão do campo.
**Correção:** ausente conta como não verificado.

### LOW

**L8 — os dois prefixos novos de escopo não tinham teste**; a suíte passava idêntica com ou sem
eles. **Correção:** casos adicionados. O auditor também observou que `/api/mcp/review` é linha
redundante, porque `/api/mcp` já está em `ADMIN_SCOPE_PREFIXES` e é avaliado antes — mantida por
clareza, com o teste registrando o comportamento real (admin em todos os métodos).

**L10 — `seq: NaN` derrotava a checagem de monotonicidade do AG-UI.** `NaN <= x` é sempre falso,
então `0,5,NaN,2,3` validava limpo apesar da regressão 5 → 2. **Correção:** exige número finito.

## 3. O que resistiu ao ataque (registrado sem enfeite)

- Casamento de domínio: `evil-example.com` contra `example.com`, ponto final, userinfo
  (`https://example.com@evil.com/`), maiúsculas, IDN/punycode e `example.com.evil.com` — todos
  negados. A função de sufixo está certa; o furo era a ausência de URL, não a comparação.
- Prototype pollution no OTel: não existe. `__proto__` e `constructor` são barrados pela allowlist
  antes da atribuição; objetos e arrays como valor de atributo são descartados.
- Ring buffer do OTel: limitado a 500 spans, sem crescimento ilimitado.
- Autenticação nas quatro rotas novas: exigida e verificada (401 nas quatro).
- Wildcards no gate de MCP (`fs:*`) não contornam a detecção de ampliação.
- Injeção de frame SSE no stream do Loop: `encodeSse` usa `JSON.stringify`, um título com
  `\n\nevent: RUN_FINISHED` sai escapado numa linha `data:` só.

## 4. Pendências honestas (não corrigidas aqui)

- A allowlist do navegador é lida de `key_value['browser']['allowed_domains']`, e **nada no
  repositório escreve essa chave**. O "override persistido no painel" descrito no cabeçalho da rota
  ainda não existe; o chamador precisa passar `allowedDomains` no corpo.
- `GET /api/loop/{id}/stream` monta o corpo inteiro em memória em vez de streamar, então um cliente
  `EventSource` reconecta em laço (~3 s), reexecutando auth e leituras de banco.
- **Resolvido — loja de aprovações de MCP.** Antes, sem ela, o estado `approved` não era
  alcançável por `POST /api/mcp/review`. Agora: migração aditiva
  `177_mcp_review_approvals.sql` (tabela `mcp_review_approvals` com `tenant_id` + índice, uma
  linha corrente por `(tenant_id, name, source)`, permissões normalizadas, revogação por
  `revoked_at` sem apagar linha) e o módulo `src/lib/db/mcpReviewApprovals.ts`. A rota de revisão
  carrega o `prior` dessa loja pela `name` + `source` do candidato, nunca do corpo.
  `POST /api/mcp/review/approve` (admin, corpo `strictObject`, flag `MCP_REVIEW_ENABLED`) grava a
  aprovação humana, mas reavalia o candidato e recusa com `422 MCP_REVIEW_DENIED` o que o gate
  nega; `POST /api/mcp/review/revoke` revoga. A re-revisão por permissão ampliada e por publisher
  não verificado continua sendo decidida pelo motor puro. Limites honestos: `approved_by` só
  identifica o ator quando o request passou pelo pipeline de authz (`<tipo>:<id>`); invocação em
  processo fica `management:unattributed`. Não há histórico de aprovações — reaprovar sobrescreve
  a linha corrente. E o ciclo do plano ainda não fecha em instalar/habilitar: não há instalador
  ligado.
- `decideBrowserAction` e `reviewMcpCandidate` não têm consumidor além do endpoint consultivo que
  os expõe: não há driver Playwright nem instalador de MCP ligado. Nada aqui é exploração remota
  hoje — é contrato de política, consertado antes de existir um executor que dependa dele.

## 5. Verificação após as correções

61/61 nas sete suítes da Fase 2 · `typecheck:core` e `tsc -p open-sse` limpos ·
`eslint --max-warnings=0` em todo arquivo alterado · `check:route-validation` PASS (706 rotas) ·
`check:api-docs-refs` OK (703 caminhos na spec, todos com rota real) · gates de i18n (cobertura,
drift de valor, glossário) PASS · knip sem símbolos mortos nos arquivos tocados · `check:cycles`,
`check:error-helper`, `check:env-doc-sync` e `check:migration-numbering` OK.
