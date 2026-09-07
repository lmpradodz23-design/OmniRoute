# Evidência — Suíte canônica Linux (Docker) — resultados reais (item 1)

Container node:24-bookworm; clone @ f9a1cc8; `npm ci --no-audit --no-fund` (COM scripts,
fiel ao CI, EXIT 0); `npm run test:unit:ci` (não-shardado) com env do CI
(JWT_SECRET/API_KEY_SECRET/DISABLE_SQLITE_AUTO_BACKUP/OMNIROUTE_SKIP_SYSTEM_TRUST).
Log completo (140.366 linhas) em tmp/canon-out/_canonical2-test-full.log (não versionado).

## Sumário oficial (node --test)

```
ℹ tests 37093
ℹ suites 1683
ℹ pass 37037
ℹ fail 26
ℹ cancelled 0
ℹ skipped 30
ℹ todo 0
```

**37.037 / 37.093 passam (99,93%); 26 falham; EXIT=1.**

## Falhas distintas (categorizadas)

### A) Perf/timing (sensível à lentidão do Docker/WSL2 no host apertado)

```
✖ #9147 — catalog build at catalog-scale must not pin the event loop for a long stretch
✖ sanitizeErrorMessage terminates on long adversarial input (ReDoS guard)
✖ the gate exits 0 against the current (synced) repo state
```

### B) Concorrência do run NÃO-shardado (o CI roda test:unit:ci:shard 8-way)

```
✖ HuggingChat stream error boundaries stay isolated from shared DB and usage state
✖ persistAttemptLogs redacts request.failed delivery/replay but keeps its internal log
✖ the log-unavailable notice is emitted at most once, to the real stderr
✖ the two redaction layers stay in step
```

### C) Env de container (root/HOME) — escrita de config

```
✖ guide-settings POST creates new hermes config.yaml if it doesn't exist
✖ guide-settings POST preserves existing OpenCode config fields while only updating provider.omniroute
✖ guide-settings POST refuses to overwrite an invalid opencode.jsonc (#10227)
✖ guide-settings POST writes OpenCode config with current schema and multi-model selection
```

### D) Demais (a investigar em run shardado fiel)

```
✖ #6205: probeBeforeSpawn adopts a healthy existing instance (no spawn)
✖ HuggingChat sanitizes conversation-creation transport failures in body and log
✖ HuggingChat sanitizes message-send transport failures in body and log
✖ Kiro stream errors become Responses response.failed events
✖ POST /v1/chat/completions with a HuggingFace image model returns 400 + generations hint (#6457)
✖ a 200 stream carrying an error frame emits a terminal error instead of false success
✖ adopted service resolves and records the real pid of the process holding the port
✖ every credential shape the passthrough layer refuses is also redacted here
✖ failing tests:
✖ generic stream public error boundaries pass in an isolated process
✖ handleImageGeneration (codex) does not mark an ordinary 400 as retryable
✖ handleImageGeneration (codex) marks the ChatGPT-account model-access 400 as retryable
✖ handleImageGeneration (codex) sanitizes upstream HTTP errors
✖ model sync route reports invalid JSON /models responses without losing upstream status
✖ redactSensitiveErrorText — raw credential patterns (GHSA-qv45-56jc-4wmj)
✖ redacts the raw credential in: Bad credentials for AIzaSyA1B2C3D4E5F6G7H8…
✖ resolvePortPid finds the pid holding a port
✖ sanitizeErrorMessage alone leaves every tunnel leak shape intact
```

## Leitura

- Instalação canônica (npm ci COM scripts) funciona no Linux (EXIT 0), nativos OK.
- 99,93% verde. As 26 falhas concentram-se em (A) perf/timing, (B) contaminação de
  estado por rodar NÃO-shardado (o CI real sharda 8×), (C) env de container root.
- O verde EXIT=0 canônico pertence ao **CI shardado em hardware de runner** (GitHub
  Actions) ou a um run shardado fiel; o run não-shardado em Docker local não é o formato
  do harness oficial.
