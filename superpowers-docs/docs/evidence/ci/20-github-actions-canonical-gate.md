# Evidência — Gate canônico no GitHub Actions oficial (Opção 3)

## Setup (upstream intocado)

- Fork: `lmpradodz23-design/OmniRoute` (fork de `diegosouzapw/OmniRoute`).
- Branch exclusiva: `validate-f9a1cc8` @ **`f9a1cc8a9b7336e394ef921c753f5da691798df9`** (push do commit exato).
- Actions habilitado; workflow `CI` (ci.yml) disparado.
- Run: **34093531998** — https://github.com/lmpradodz23-design/OmniRoute/actions/runs/34093531998

## Resultado: conclusion=FAILURE → **GATE NO-GO**

Jobs relevantes ao gate:

- **Lint: FAILURE** — quebra em `npm run check:agent-skills-sync` (exit 2): regenera 1 arquivo
  de skill ("Generated: 1") → drift de artefato gerado no commit congelado.
- **Build: FAILURE**.
- **Unit Tests: 7/8 shards FAILURE** (apenas 4/8 passou). Shard 1/8: **4554 testes, 4549 pass,
  3 fail**. As 3 falhas por shard (cluster consistente):
  - `POST /v1/chat/completions with a HuggingFace image model returns 400 + generations hint (#6457)`
  - `sanitizeErrorMessage terminates on long adversarial input (ReDoS guard)` (~3.7s)
  - `sanitizeErrorMessage alone leaves every tunnel leak shape intact`
- Também FAILURE: Integration Tests (1/2, 2/2), Vitest, Docs Sync (Strict).
- SUCCESS: Change Classification, Bun SQLite (x2), Security Tests, Quality Gates/Ratchet,
  i18n (todos), Ecosystem/Protocol E2E (advisory), Unit 4/8.
- SKIPPED: Coverage, E2E, Electron Smoke, Package Artifact, SonarQube, PR Test Policy.

## Reprodução comparativa (regra do aprovador)

1. **Runner oficial (não local):** as MESMAS falhas (HuggingFace #6457, ReDoS, sanitize/
   tunnel-leak) que apareceram no Docker local (evid. 19) reproduzem no GitHub Actions.
   → Não são artefato do ambiente local.
2. **Upstream no mesmo SHA:** o CI do **upstream** na `release/v3.8.51` está **vermelho**:
   "Release-Green (continuous)" = **failure**; "Nightly Node Compat/LLM Security/Resilience"
   = **failure**. O workflow `CI` do upstream falha com frequência em PRs.
   → As falhas são **inerentes ao commit congelado `f9a1cc8`**, não introduzidas por nós.

## Conclusão

- **Gate NÃO aprovado.** Lint, Build e 7/8 shards falham no CI oficial.
- **Causa raiz:** o SHA congelado `f9a1cc8` (v3.8.51) **não possui CI verde** — nem no fork,
  nem no upstream. As falhas de teste são pré-existentes do upstream (HuggingFace image,
  ReDoS timing, redaction/tunnel-leak), o Lint tem drift de skills gerados, e o Build falha.
- **Nenhum teste foi alterado.** Nenhum código de produto foi modificado.
