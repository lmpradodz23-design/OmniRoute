# RELEASE_READINESS — OmniRoute v3.8.51 (branch `fix/final-user-readiness`)

> Estado: **FINAL** — exit codes reais em `TEST_MATRIX.md`; veredito das 3 auditorias + verificação cruzada em `FINAL_THREE_AGENT_REVIEW.md`. Publicação restrita à autorização condicional (push + PR + CI + GHCR por workflow); **npm publish, Docker Hub, GitHub Release e deploy NÃO executados**.

## 1. Critério de conclusão da missão (05-EXECUTION-PLAN §5)

| Critério                                                      | Estado                                                                                                   | Evidência                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| blockers internos = 0                                         | PASS                                                                                                     | `AUTONOMOUS_MISSION_STATE.md` §Blockers (só externos: E-4 code-signing, gitleaks/semgrep locais, E2E pago)                     |
| Critical = 0 · High = 0                                       | PASS                                                                                                     | `FINAL_THREE_AGENT_REVIEW.md` §6: 1 CRITICAL (X-1) e 4 HIGH (C-01, C-02, C-03, X-2) corrigidos e verificados                   |
| lint PASS                                                     | PASS (exit 0)                                                                                            | `TEST_MATRIX.md` §1                                                                                                            |
| typecheck PASS (core, noimplicit, open-sse+bin)               | PASS (exit 0 ×3)                                                                                         | `TEST_MATRIX.md` §1; api-typecheck 289 = baseline                                                                              |
| unit PASS                                                     | PASS (0 regressões; falhas Windows-only classificadas contra o baseline)                                 | `TEST_MATRIX.md` §2                                                                                                            |
| integration PASS                                              | PASS (27/27 falhas idênticas ao baseline; 0 regressões)                                                  | `TEST_MATRIX.md` §2                                                                                                            |
| security tests PASS                                           | PASS                                                                                                     | fase01, authz 144, MCP escopos, SSRF (127/127 após B-1), guardrails                                                            |
| migrations + rollback PASS                                    | PASS                                                                                                     | R-1/R-4 suítes; `ROLLBACK.md`                                                                                                  |
| build PASS · Electron package PASS · clean-install smoke PASS | PASS (build, pack-artifact, pack-boot, install-upgrade; standalone hygiene + boot — ver §3/§5 da matriz) | `TEST_MATRIX.md` §3/§5                                                                                                         |
| secret scan PASS                                              | **NOT_RUN local** (gitleaks ausente) — compensado por sweep em todo commit + CI estrito (SC-1)           | `SECURITY_REMEDIATION.md` §3                                                                                                   |
| dependency scan PASS                                          | PASS (0 critical / 0 high / 3 moderate rastreados)                                                       | `npm audit --omit=dev`                                                                                                         |
| functional acceptance PASS                                    | PASS                                                                                                     | `USER_JOURNEYS.md`; `npm run test:compat` 8/8                                                                                  |
| a11y PASS                                                     | parcial (escopo executado em `USER_JOURNEYS.md`); axe E2E depende de Playwright local                    | `TEST_MATRIX.md`                                                                                                               |
| 3 auditorias independentes PASS                               | PASS (A/B/C aprovado com ressalvas; ressalvas corrigidas e verificadas)                                  | `FINAL_THREE_AGENT_REVIEW.md`                                                                                                  |
| sem porta/processo órfão                                      | PASS                                                                                                     | verificação `Get-NetTCPConnection` após os E2E (só serviços do SO)                                                             |
| docs atualizadas                                              | PASS                                                                                                     | `docs/guides/UNINSTALL.md` (+pt-BR), `docs/security/GUARDRAILS.md`, `docs/ops/DATABASE_GUIDE.md`, quick start pt-BR, `audit/*` |
| working tree limpa ou só blockers externos documentados       | PASS (`tsconfig.json` reformatado pelo `next build` é o único ruído, não commitado)                      | `git status`                                                                                                                   |

## 2. Bloqueios externos (não travam o código; travam a publicação)

| Item                                           | Motivo                                                              | Necessário do operador                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| E-4 code-signing Electron                      | certificados Windows/macOS não estão no repositório nem no ambiente | fornecer certificados/segredos no CI (`electron-builder` `CSC_*`)                          |
| Secret scan local                              | `gitleaks` ausente na máquina                                       | instalar gitleaks (CI já roda estrito)                                                     |
| E2E autenticado com provedor real              | credencial + custo                                                  | chave de um provedor de teste (as chaves coladas no chat **não** serão usadas; rotacionar) |
| Publicação (push/PR/npm/GHCR/Electron/Release) | autorização condicional: só após COMPLETED                          | confirmação final do operador (já dada condicionalmente em 2026-09-09)                     |

## 3. Procedimento de release proposto (após COMPLETED)

1. `git push origin fix/final-user-readiness` → PR para `release/v3.8.51` (ou `main`, conforme o fluxo do fork) com `TEST_MATRIX.md`, `FINAL_REPORT.md` e `FINAL_THREE_AGENT_REVIEW.md` anexados.
2. CI (`quality.yml`, `ci.yml`, `semgrep.yml`, `codeql.yml`) verde — inclui secret scan estrito e supply-chain pins.
3. Imagem: `docker-publish.yml` → `ghcr.io/lmprado-dz23/omniroute:3.8.51` (GITHUB_TOKEN; sem Docker Hub).
4. npm: `npm-publish.yml` (gate `repository.url` = fork) — **somente** com autorização explícita adicional.
5. Electron: build sem assinatura só para smoke interno; instaladores públicos exigem E-4.
6. Rollback: `audit/ROLLBACK.md` (npm/Docker/Electron/código-fonte + banco).

## 4. Riscos residuais conhecidos

- SC-3/SC-9/SC-10 (LOW/MEDIUM, rastreados): `adm-zip` via `onnxruntime-node` (install-time), download no `postinstall`, `latest` sem quote em `autoUpdate.ts`.
- P-2/P-3: plugins rodam como processo filho com os privilégios do servidor (agora **declarado** na UI e no SDK); sandbox real é melhoria futura.
- R-15/R-16 (LOW): caches em `Map` com sweep e 1 INSERT/request de log — adiados com justificativa.
- Falhas de teste **pré-existentes no Windows** listadas em `TEST_MATRIX.md` (BLOQUEADO POR AMBIENTE, provadas por stash) — não afetam Linux/CI.
