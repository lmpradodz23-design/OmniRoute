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

| Item                                           | Motivo                                                                                                                                                                                                                             | Necessário do operador                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-4 code-signing Electron                      | pipeline pronto (`electron-release.yml` + `scripts/build/electron-signing.mjs`): assina sozinho assim que os repository secrets existirem e, sem eles, segue gerando o build sem assinatura; pendentes só os certificados/segredos | obter os certificados (Apple Developer ID + notarização; Authenticode ou Azure Trusted Signing), criar os secrets listados em `docs/guides/ELECTRON_GUIDE.md` §Code Signing e re-disparar `electron-release.yml` para o tag |
| Secret scan local                              | `gitleaks` ausente na máquina                                                                                                                                                                                                      | instalar gitleaks (CI já roda estrito)                                                                                                                                                                                      |
| E2E autenticado com provedor real              | credencial + custo                                                                                                                                                                                                                 | chave de um provedor de teste (as chaves coladas no chat **não** serão usadas; rotacionar)                                                                                                                                  |
| Publicação (push/PR/npm/GHCR/Electron/Release) | autorização condicional: só após COMPLETED                                                                                                                                                                                         | confirmação final do operador (já dada condicionalmente em 2026-09-09)                                                                                                                                                      |

## 3. Procedimento de release proposto (após COMPLETED)

1. `git push origin fix/final-user-readiness` → PR para `release/v3.8.51` (ou `main`, conforme o fluxo do fork) com `TEST_MATRIX.md`, `FINAL_REPORT.md` e `FINAL_THREE_AGENT_REVIEW.md` anexados.
2. CI (`quality.yml`, `ci.yml`, `semgrep.yml`, `codeql.yml`) verde — inclui secret scan estrito e supply-chain pins.
   - 2026-09-12: o primeiro CI do PR #5 reprovou 7 jobs (31 testes + 8 gates); rodada de correção registrada em `TEST_MATRIX.md` §6 e `FINAL_THREE_AGENT_REVIEW.md` §7 — 3 HIGH corrigidos (2 do fix loop, 1 pré-existente de segurança). Evidência do CI verde, do merge e do digest GHCR: preenchida abaixo quando ocorrer.
3. Imagem: `docker-publish.yml` → `ghcr.io/lmprado-dz23/omniroute:3.8.51` (GITHUB_TOKEN; sem Docker Hub).
   - 2026-09-12: **PR #5 mesclado** em `release/v3.8.51` (merge commit `bd518dafd`, 18/18 checks verdes no HEAD `4941e7fad`, 184 commits). O `docker-publish.yml` disparado pelo merge (run 34682049955) falhou nos dois builds em "Login to Docker Hub" (`Username and password required`): o fork não tem `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` (a run anterior na base, 34373763565, falhou igual). Correção: o workflow passa a detectar as credenciais do Docker Hub e, na ausência, publica só no GHCR (tags, login, manifest e descrição do Docker Hub condicionais; inspeção pós-publicação pelo GHCR). Evidência da imagem GHCR: abaixo.
   - 2026-09-12: **PR #6 mesclado** (`ce776db34`, 13/13 checks) → `docker-publish.yml` run **34682777453** concluída com sucesso (prepare → build amd64 + arm64 → manifests multi-arch, SBOM CycloneDX, Trivy HIGH/CRITICAL advisory e **gate Trivy CRITICAL bloqueante aprovado**). Imagem publicada e **acessível anonimamente** (`docker manifest inspect` sem login):
     - `ghcr.io/lmprado-dz23/omniroute:next` — índice OCI `sha256:ce399d87dd29cc0014910fe6bb2008294eb5eca040b5e113f57095dca22ad018` (linux/amd64 `sha256:2b43e25f…`, linux/arm64 `sha256:44648ba1…`, + attestation manifests)
     - `ghcr.io/lmprado-dz23/omniroute:next-web` — índice OCI `sha256:07417c576dd61b5d14d8340d1145b9d8a96394a2baeb725bbcdd876788af7263`
     - variantes `-bun` / `-web-bun` opcionais não geradas nesta run (build Bun `continue-on-error`, sem digests) — sem impacto nas imagens principais.
   - **Por que `:next` e não `:3.8.51`:** `scripts/ci/resolve-docker-publish-version.sh` mapeia push na branch de release padrão para `next`; a tag `3.8.51` (e `:latest`) só nasce de uma tag git `v3.8.51`, de um GitHub Release ou de `workflow_dispatch` sobre essa tag — ações **fora da autorização** desta missão (a tag `v*` também dispara `electron-release.yml`). Fica como decisão do operador.
   - 2026-09-12 (Loop + Buzz): **PR #8 mesclado** (`dac77089d`, 14/14 checks verdes no HEAD `2d3161c38`) e **PR #9 mesclado** (`45be81450`). O `docker-publish.yml` run **34693304586** concluiu com sucesso sobre `45be81450` e republicou, multi-arch (linux/amd64 + linux/arm64), já com Loop Engine e Buzz Hub dentro:
     - `ghcr.io/lmprado-dz23/omniroute:next` — índice OCI `sha256:11d5dd427af6a779471f42fcb9adfb1c91dee24ba5f00f279921cb70924c2cdb`
     - `ghcr.io/lmprado-dz23/omniroute:next-web` — índice OCI `sha256:1282f0ace0e7625bc1a1f290d1188631f9ea70707b69823dea18061ea99e2bc4`

### 3.1 Prontidão para o usuário final (2026-09-12)

Auditoria do percurso "baixar → instalar → usar", a pedido do operador. Quatro problemas reais encontrados e corrigidos:

| #   | Problema                                                                                                                                                                             | Efeito no usuário                                                                                                    | Onde foi corrigido                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | O Quick Start mandava rodar `ghcr.io/lmprado-dz23/omniroute:latest`, tag que **nunca existiu** neste fork (só uma publicação SemVer promove `:latest`, e nenhuma versão foi lançada) | o comando principal da primeira página falhava com `manifest unknown` para qualquer pessoa                           | PR #9: 756 referências completas da imagem passam a nomear `:next` em 177 arquivos, incluindo as 41 traduções; nota de fork, nota de canal e guia de Docker passam a dizer o que existe hoje |
| 2   | `contrib/podman/omniroute.container` oferecia a mesma tag inexistente como alternativa a construir localmente                                                                        | quem descomentasse a linha recebia `manifest unknown` de um arquivo feito para ser copiado e executado               | PR #10                                                                                                                                                                                       |
| 3   | O job de publicação nunca **ligava** a imagem: validava manifest, gerava SBOM e escaneava CVEs, mas nada provava que ela sobe                                                        | uma tag quebrada só apareceria na máquina do usuário                                                                 | PR #10: o job sobe o contêiner como o README manda, exige `/healthz` em até 60 s com os logs anexados na falha, e chama `/v1/models`                                                         |
| 4   | A imagem publicada não registrava o commit de origem                                                                                                                                 | num canal mutável, impossível saber que código se está rodando; dois digests de dias diferentes eram indistinguíveis | PR #10: `org.opencontainers.image.revision` gravado a partir de `github.sha`                                                                                                                 |

Verificação do caminho "from source" executada nesta máquina sobre `release/v3.8.51`: `npm run build` saiu 0; `npm start` com `DATA_DIR` isolado aplicou **172 migrações** (incluindo `175_loop_engine_and_buzz_bridge` e `176_buzz_outbox_retry_schedule`) num banco novo e respondeu `/healthz` **200** em 6 s; `/v1/models` sem credencial devolveu **401**, o painel **307** e `/api/loop` **401** (sem revelar o estado da flag). Servidor encerrado e porta liberada depois do teste.

Continua **fora da autorização** e como decisão do operador: `:latest`, as tags `:X.Y.Z` e os instaladores de desktop exigem a tag git `v3.8.51`, que dispara `electron-release.yml` — e nele a perna `publish-npm` roda em push de tag (`github.event_name != 'workflow_dispatch'`), ou seja, **tagear tentaria publicar no npm**, ação proibida. Os instaladores gerados seriam **sem assinatura** (E-4).

### 3.2 Fase 2 integrada (2026-09-12)

**PR #13 mesclado** (`fa7047ca1`, 14/14 checks verdes no HEAD `1ed8bbeef`) — MCP review gate,
Browser Guard, AG-UI, OTel-lite, reconhecedores brasileiros de CEP e chave PIX, e duas correções
no fluxo de OAuth. Transplante seletivo de `superpowers-on-v3.8.51`: 18 arquivos novos menos um,
três flags aditivas, e nenhuma das reversões que aquela branch carregava (identidade do fork,
rebaixamento do `hono`, remoção de gates). Auditoria adversarial em `audit/FASE2_REVIEW.md`:
veredito inicial **REPROVADO**, todos os achados corrigidos na causa raiz com teste de regressão.

**PRs #1 e #2 fechados como obsoletos.** Nenhum PR aberto no repositório.

**Imagem republicada** pela run **34704223078** sobre `fa7047ca1`, com o teste de boot passando
(`/healthz` respondeu; `GET /v1/models` devolveu 401 sem credencial):

- `ghcr.io/lmprado-dz23/omniroute:next` — índice OCI `sha256:ed13e0af270179e12e3a97d6cbe83446ad6ea5d79ad780ee4efb0d5b7be91657`
- `org.opencontainers.image.revision` = `fa7047ca16ca884f79df94242fa5c2fe5e3e60d4` em linux/amd64 e linux/arm64

**Ciclo de correção desta etapa:** a auditoria reprovou o código como veio, e depois o CI apontou
mais cinco defeitos que a própria integração introduziu — SQL cru num handler de rota, um byte NUL
literal num arquivo-fonte, duas regressões de complexidade, uma skill gerada desatualizada e um
export sem chamador. Todos corrigidos; nenhum contornado.

**Trava de npm:** o PR #11 (`f9ade6f17`) tornou a perna `publish-npm` do `electron-release.yml`
opt-in por `ENABLE_NPM_PUBLISH`, desligada por padrão. Antes disso uma tag `v3.8.51` tentaria
publicar de verdade no pacote `omniroute`, que pertence ao upstream: `npm view omniroute@3.8.51`
é 404 (o upstream está no 3.8.50), então o freio de "versão já publicada" não seguraria.

4. npm: `npm-publish.yml` (gate `repository.url` = fork) — **somente** com autorização explícita adicional.
5. Electron: build sem assinatura só para smoke interno; instaladores públicos exigem E-4.
6. Rollback: `audit/ROLLBACK.md` (npm/Docker/Electron/código-fonte + banco).

## 4. Riscos residuais conhecidos

- SC-3/SC-9/SC-10 (LOW/MEDIUM, rastreados): `adm-zip` via `onnxruntime-node` (install-time), download no `postinstall`, `latest` sem quote em `autoUpdate.ts`.
- P-2/P-3: plugins rodam como processo filho com os privilégios do servidor (agora **declarado** na UI e no SDK); sandbox real é melhoria futura.
- R-15/R-16 (LOW): caches em `Map` com sweep e 1 INSERT/request de log — adiados com justificativa.
- Falhas de teste **pré-existentes no Windows** listadas em `TEST_MATRIX.md` (BLOQUEADO POR AMBIENTE, provadas por stash) — não afetam Linux/CI.
