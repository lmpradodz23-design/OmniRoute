# Evidência — LINT / TEST / BUILD / SMOKE do OmniRoute (resultados reais)

Ambiente: Windows 11, Node 24.16, npm 11.13, VS Build Tools 2022 (VC 14.44) instalado,
nativos compilados, DATA_DIR isolado, porta 28128. Logs: `_omni-ltb-full.log`,
`_omni-test-subset2.log`, `_omni-test-authz-abs.log`, `_omni-smoke.log`.

## LINT — EXIT=2 (código sem violações)

`eslint .` rodou por completo (~15 min). Exit 2 **não** é violação de código: a saída diz
"There are suppressions left that do not occur anymore ... re-run with --prune-suppressions".
É higiene de supressões obsoletas em `config/quality/eslint-suppressions.json`. Com
`--pass-on-unpruned-suppressions` o exit seria 0. **Nenhuma violação ativa de lint.**

## BUILD — EXIT=0 ✅

`npm run build` (Next/Turbopack, ~32 min) concluiu. 219 warnings (não-fatais); copiou os
binários nativos do better-sqlite3 para o standalone. Um warning ENOENT de trace-copy do
Tailscale (não-fatal). **Build de produção OK.**

## SMOKE — EXIT=0 ✅ (escopo limitado)

Servidor subiu (health 200), rotas respondem: `/v1/models` 401, `OPTIONS /v1/messages` 204,
`OPTIONS /v1/responses` 204, `POST` sem key → 400 tipado. **Comprova startup/health/
existência de rotas/tratamento sem auth. NÃO comprova geração/roteamento real** (exige
chamada autenticada com provider). Ver correção de órfão no `_omni-smoke.log`.

## TEST — resultados reais e limites

1. **Suíte COMPLETA (`test:unit:fast`): EXIT=124** — não produz saída em 60 min (volume:
   milhares de arquivos + tsx transpilando a árvore; não é trava de setup — o probe de um
   diretório passou em ~20s).
2. **Subconjunto (9 dirs) com invocação ingênua: 338 ok / 141 not-ok**, sendo **138** o
   MESMO artefato de runner: `src/lib/db/adapters/runtimeRequire.ts:13`
   `createRequire(process.argv[1])` recebe um GLOB RELATIVO sob `node --test` →
   `ERR_INVALID_ARG_VALUE`. Em dev/prod `argv[1]` é o entrypoint real (absoluto) e funciona
   (o smoke provou o better-sqlite3). Artefato de invocação no Windows, não defeito.
3. **authz com GLOB ABSOLUTO: 215 ok / 35 fail, 0 erros de createRequire** — confirma o
   item 2. As 35 falhas restantes são **asserções dependentes de env/fixture do harness**:
   - peer-stamp: espera `'stamp-tok'` (fixture via env) e recebe UUID gerado em runtime;
   - `#2257` REQUIRE_API_KEY=false → anonymous: `expected true / actual false` (config de
     auth que a suíte completa injeta e o run isolado não reproduz).
     `better-sqlite3` funciona nesses testes (DB criado). Nenhuma falha é regressão nossa
     (commit congelado f9a1cc8; nenhum código de produto foi alterado).

## Síntese honesta

- LINT: limpo (exit 2 = supressões). BUILD: OK. SMOKE: OK (escopo limitado).
- TEST: centenas de testes passam; o restante são (a) artefato de runner (argv[1] relativo)
  e (b) testes de auth-policy dependentes de env/fixture do harness completo. A suíte
  completa não termina em 60 min neste ambiente. **Recomenda-se, em fase dedicada, rodar os
  testes via o harness oficial completo (CI/Docker) para resultado verde canônico.**
