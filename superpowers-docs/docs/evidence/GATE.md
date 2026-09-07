# GATE — Fase 0 → Fase 1 (OmniRoute Unified) — ATUALIZADO

- **Data:** 2026-09-06/07 · **Decisão recomendada:** **GO condicional** (aprovação do humano pendente)
- Supersede o NO-GO provisório anterior após a **Opção A** (VS Build Tools + instalação limpa).

## 1. Os quatro resultados exigidos (execução real — evid. 17)

```
LINT       EXIT=2   → SEM violação de código (exit 2 = supressões obsoletas;
                       com --pass-on-unpruned-suppressions = 0)
TEST_FAST  (suíte completa) EXIT=124 → não termina em 60 min (volume + tsx; não é trava)
TEST (subconjunto real)      → centenas passam; falhas = (a) artefato de runner
                       runtimeRequire.ts:13 createRequire(argv[1]) com glob relativo
                       (some com caminho absoluto) e (b) ~35 auth-policy dependentes de
                       env/fixture do harness. Nenhuma é regressão (commit congelado).
BUILD      EXIT=0  ✅ (Next/Turbopack ~32 min; nativos copiados)
SMOKE      EXIT=0  ✅ startup + health 200 + rotas (/v1/models 401, OPTIONS
                       /v1/messages|/v1/responses 204, POST sem key → 400 tipado)
```

**O SMOKE comprova:** startup, health, existência das rotas e tratamento sem autenticação.
**NÃO comprova** geração/roteamento real de modelo (exige chamada autenticada com provider).

## 2. Estado dos bloqueios do NO-GO anterior — TODOS RESOLVIDOS

| Bloqueio (antes)                                       | Estado agora                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Sem VS Build Tools C++                                 | ✅ VS Build Tools 2022 (VC 14.44) instalado e validado (vswhere)         |
| Nativos não compilados                                 | ✅ `check-native-deps` OK (31 pkgs); `better-sqlite3` executa (prebuild) |
| node_modules invalidado por concorrência               | ✅ **uma única** instalação limpa (2 etapas), sem concorrência           |
| Pacote `bun` install.js fatal com --foreground-scripts | ✅ contornado: `--ignore-scripts` + `npm rebuild` dos nativos            |

Sem alteração de npm config global (usadas flags no comando). Sem exclusão no Defender.

## 3. O que passou (comprovado)

- 9/9 SHAs; licenças (MCP Registry Apache-2.0 híbrido — evid. 13).
- `/v1/messages` (Claude Code) e `/v1/responses` nativos; OmniRoute já vendoriza codex-chatgpt-web (v4.0.7).
- codex-chatgpt-web core: 651 pass / 4 fail (electron); launcher: 281 pass / 0 fail, build OK.
- OmniRoute: instalação/nativos/build/smoke ✅; lint sem violação.

## 4. Condições da recomendação GO

1. **Testes:** rodar a suíte **completa** no **harness oficial (CI/Docker Linux)** para o
   verde canônico (o ambiente Windows local não completa em 60 min e tem falhas
   env/fixture-dependentes; nenhuma é regressão nossa).
2. **Vendor:** manter codex-chatgpt-web **v4.0.7** nesta fase; delta → **v5.0.4** é uma fase
   isolada **após** o GO (re-auditoria do diff/testes/segurança).
3. **Smoke:** próxima execução com bind 127.0.0.1 + kill de árvore no trap (órfão do 1º
   cleanup já corrigido — evid. `_omni-smoke.log`).

## 5. Decisão pendente do aprovador

- [ ] Autorizar **GO** para a Fase 1 (com as condições acima), **ou** exigir a suíte completa
      verde via CI/Docker antes do GO.
- [ ] Confirmar manutenção do vendor v4.0.7 (delta v5.0.4 como fase isolada pós-GO).

**A Fase 1 não inicia sem esta autorização.** Nenhuma instalação sua foi alterada.

---

### Histórico — Opções de remediação (A foi executada)

- **Opção A (executada):** VS Build Tools + instalação limpa única → build/smoke OK.
- **Opção B (não usada):** baseline via Docker/compose em P: — continua disponível como
  caminho reprodutível para a suíte completa de testes (condição 4.1).
