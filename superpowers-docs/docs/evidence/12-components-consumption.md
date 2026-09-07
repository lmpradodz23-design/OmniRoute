# 12 — Auditoria de Consumo de Componentes (Fase 0)

> Objetivo: validar a **forma de consumo** e a **licença** de cada componente
> gastando disco mínimo. **Nenhum repo pesado foi clonado e nenhuma imagem foi
> baixada** (`docker pull` evitado; usados `docker manifest`/APIs de registry,
> Docker Hub API, MCR v2 API, PyPI JSON, `npm view`, GitHub API, `git ls-remote`).
>
> - Data da verificação: **2026-09-06**
> - Ambiente: Windows 11, Docker 29.7.2, uv 0.12.5, node 24.16.0 / npm 11.13.0,
>   Python **3.14** instalado (novo demais para libs → planejar **3.12 via uv**).
> - Disco `/c`: **48G livres antes → 63G livres depois** (economia respeitada;
>   variação positiva por flutuação do sistema, não consumimos disco relevante).

## Destaques (ler primeiro)

- **(a) MCP Registry — AUDITORIA MANUAL DE LICENÇA OBRIGATÓRIA.** O GitHub reporta
  `spdx_id: NOASSERTION` / `name: Other`. Em transição para Apache-2.0 (docs
  CC-BY-4.0). Não usar em produção antes de auditoria jurídica manual.
- **(b) Python 3.14 é incompatível com o ecossistema.** Fixar **Python 3.12 via uv**
  para os workers **Presidio, MarkItDown e Browser-Use**. MarkItDown declara apenas
  até 3.13; Presidio declara 3.14 no metadata **mas** depende de spaCy/modelos que
  ainda podem não ter wheels 3.14 → 3.12 é a escolha segura.
- **(c) Serviços Docker isolados:** Qdrant, OTel Collector Contrib e Presidio
  (analyzer/anonymizer) devem rodar como **serviços/containers**, não como libs no
  processo principal.
- **(d) Browser-Use = capacidade de ALTO IMPACTO.** Automação de browser com
  efeitos externos → exige **aprovação humana** no Policy Engine antes de qualquer
  ação com efeito de rede/UI externa. Rodar em worker sandbox.
- **(e) Correção de tag:** o Qdrant usa prefixo `v` — a tag é **`v1.19.1`**, não
  `1.19.1` (a inspeção de `1.19.1` retorna "no such manifest").

## Tabela-resumo

| Componente                 | Forma de consumo recomendada                                                               | Tag/versão a fixar                                                                                                                                                             | Licença                                        | Verificação real feita                                   | Riscos/limites                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Presidio**               | 2 serviços Docker isolados (analyzer + anonymizer) da MCR; alternativa: libs pip no worker | Imagem: `mcr.microsoft.com/presidio-analyzer:2.2.362` e `...-anonymizer:2.2.362` (`latest` existe, evitar). pip: `presidio-analyzer==2.2.364` / `presidio-anonymizer==2.2.364` | **MIT**                                        | PyPI JSON + MCR v2 tags/manifests                        | pip declara `<3.15,>=3.10` (até 3.14) mas spaCy/modelos → **fixar 3.12**. Imagem MCR lag do pip (362 vs 364)                                                                                   |
| **MCP Registry**           | API HTTP versionada, read-only, hospedada; ou self-host do source no SHA fixado            | API: caminho **`/v0`** em `https://registry.modelcontextprotocol.io`. Self-host: commit `739b70e`                                                                              | **NOASSERTION / "Other"** ⚠️                   | GitHub license API + probes `/v0/health` e `/v0/servers` | **Exige auditoria de licença manual** antes de uso. Schema do servidor datado `2025-12-11`                                                                                                     |
| **MarkItDown**             | Worker Python sandbox (uv/venv 3.12), lib pip                                              | `markitdown==0.1.7`                                                                                                                                                            | **MIT**                                        | PyPI JSON + GitHub license                               | `requires_python >=3.10`, classifiers **3.10–3.13 (sem 3.14)**. Muitos extras pesados — instalar só conversores necessários                                                                    |
| **Qdrant**                 | Serviço Docker                                                                             | `qdrant/qdrant:v1.19.1` (**com `v`**)                                                                                                                                          | **Apache-2.0**                                 | Docker Hub API + `git ls-remote --tags`                  | Tag sem `v` **não existe**. Multi-arch amd64+arm64, ~74 MB comprimido                                                                                                                          |
| **OTel Collector Contrib** | Serviço Docker                                                                             | `otel/opentelemetry-collector-contrib:0.160.0` (**sem `v`**, estável)                                                                                                          | **Apache-2.0**                                 | GitHub releases/latest + Docker Hub API                  | Listagem por data é dominada por `nightly`/`riscv64` — **não usar nightly**. Multi-arch incl. amd64, ~94 MB                                                                                    |
| **AG-UI**                  | Libs npm (TS/JS)                                                                           | `@ag-ui/core@0.0.59`, `@ag-ui/client@0.0.59`, `@ag-ui/encoder@0.0.59`                                                                                                          | **MIT**                                        | `npm view` + GitHub license                              | Pré-1.0 (`0.0.x`) → API pode mudar; fixar versão exata                                                                                                                                         |
| **Browser Use**            | Worker Python sandbox (uv/venv 3.12), lib pip. **Alto impacto**                            | `browser-use==0.13.10`                                                                                                                                                         | **MIT** (repo; metadata PyPI sem license expr) | PyPI JSON (deps) + GitHub license                        | `requires_python >=3.11,<4.0`. 61 deps (cdp-use, browser-harness, browser-use-core por plataforma). **Chromium NÃO vem pelo pip** (instalar à parte). **Aprovação humana** p/ efeitos externos |

---

## Evidência por componente

### 1. Presidio — Security Shield (serviço Docker isolado)

Papel: analyzer/anonymizer de PII como serviço isolado.

**pip (PyPI JSON, sem instalar):**

```
presidio-analyzer  → version: 2.2.364 | requires_python: <3.15,>=3.10 | license expr: MIT
                     py classifiers: 3.10 3.11 3.12 3.13 3.14
presidio-anonymizer→ version: 2.2.364 | requires_python: <3.15,>=3.10 | license expr: MIT
                     py classifiers: 3.10 3.11 3.12 3.13 3.14
```

**Imagens Docker oficiais (MCR v2 API, sem pull):**

```
GET https://mcr.microsoft.com/v2/presidio-analyzer/manifests/latest
  mediaType: application/vnd.oci.image.index.v1+json
  platforms: ['linux/amd64', 'linux/arm64']
GET https://mcr.microsoft.com/v2/presidio-analyzer/tags/list
  count: 47 | maior tag numérica 2.2.x: 2.2.362 | 'latest' presente: True
GET https://mcr.microsoft.com/v2/presidio-anonymizer/tags/list  → 200 (mesma linha 2.2.x)
```

- **Consumo recomendado:** dois serviços Docker (analyzer + anonymizer) atrás da
  interface própria; contexto do modelo nunca recebe o texto sensível diretamente.
- **Fixar:** imagem `:2.2.362` (mais recente numérica na MCR). Se consumir via pip
  no worker, `==2.2.364` **sob Python 3.12** (spaCy/modelos são o gargalo real de
  compatibilidade, não o metadata do Presidio).
- **Licença:** MIT (confirmado no PyPI license_expression).

### 2. MCP Registry — descoberta (API versionada, read-only)

```
GET https://registry.modelcontextprotocol.io/v0/health
  → {"status":"ok","github_client_id":"Iv23liUydBbI7Z2Q9bOZ"}
GET https://registry.modelcontextprotocol.io/v0/servers?limit=1
  → {"servers":[{"server":{"$schema":".../schemas/2025-12-11/server.schema.json", ...}}]}
GET https://api.github.com/repos/modelcontextprotocol/registry/license
  → spdx_id: NOASSERTION | name: Other | key: other | path: LICENSE
```

- **Consumo recomendado:** consumir a **API pública hospedada** (caminho versionado
  `/v0`), read-only — sem SDK/clone necessário. Se for self-host, pinar o commit de
  referência `739b70e8bc1bea203c5a35ab699f1df51d091568`.
- **Licença:** ⚠️ **NOASSERTION** — transição declarada para Apache-2.0 (docs
  CC-BY-4.0). **Auditoria jurídica manual obrigatória antes de uso.**

### 3. MarkItDown — Knowledge Hub (worker Python sandbox)

```
GET https://pypi.org/pypi/markitdown/json
  version: 0.1.7 | requires_python: >=3.10 | license expr: MIT
  py classifiers: 3.10 3.11 3.12 3.13  (SEM 3.14)
GET https://api.github.com/repos/microsoft/markitdown/license → spdx_id: MIT
```

- **Consumo recomendado:** worker Python em **uv/venv 3.12**; `markitdown==0.1.7`.
- **Risco:** classifiers não listam 3.14 (bate com o bloqueio de 3.14). Instalar só
  os extras de conversão necessários (o pacote tem muitos extras pesados opcionais).

### 4. Qdrant — índice vetorial (serviço Docker)

```
docker manifest inspect qdrant/qdrant:1.19.1
  → erro: "no such manifest: docker.io/qdrant/qdrant:1.19.1"   (tag SEM 'v' não existe)
GET https://hub.docker.com/v2/.../qdrant/tags/v1.19.1
  name: v1.19.1 | arch: ['linux/amd64','linux/arm64'] | pushed 2026-09-03 | full_size ~74 MB
git ls-remote --tags https://github.com/qdrant/qdrant v1.19.1
  → de333e3c04660fe475d6275e9efc9fb9f54138fe  refs/tags/v1.19.1
GET https://api.github.com/repos/qdrant/qdrant/license → spdx_id: Apache-2.0
```

- **Consumo recomendado:** serviço Docker `qdrant/qdrant:v1.19.1` (amd64 confirmado).
- **Correção importante:** usar a tag **com prefixo `v`**. (Commit de build de
  referência `6ab21cac...` = "Bump version to 1.19.1", distinto do commit da tag.)

### 5. OpenTelemetry Collector Contrib — observabilidade (serviço)

```
GET https://api.github.com/repos/open-telemetry/opentelemetry-collector-contrib/releases/latest
  → tag: v0.160.0 | published: 2026-09-02
GET https://hub.docker.com/v2/.../opentelemetry-collector-contrib/tags/0.160.0
  name: 0.160.0 | arch: linux/amd64, arm64, 386, arm, ppc64le, s390x, riscv64 | ~94 MB
GET https://api.github.com/repos/.../license → spdx_id: Apache-2.0
```

- **Consumo recomendado:** serviço Docker `otel/opentelemetry-collector-contrib:0.160.0`
  (tag estável **sem `v`**; amd64 confirmado).
- **Risco:** a ordenação por data do Docker Hub mostra `nightly`/`riscv64` no topo —
  **não usar `nightly`**. Fixar a versão estável explícita.

### 6. AG-UI — protocolo/lib de eventos

```
npm view @ag-ui/core    → version 0.0.59 | license MIT | latest 0.0.59
npm view @ag-ui/client  → version 0.0.59 | license MIT | latest 0.0.59
npm view @ag-ui/encoder → version 0.0.59 | license MIT | latest 0.0.59
GET https://api.github.com/repos/ag-ui-protocol/ag-ui/license → spdx_id: MIT
```

- **Consumo recomendado:** libs npm fixadas em `0.0.59` (core + client; encoder se
  necessário). Pré-1.0 → travar versão exata, API pode quebrar entre releases.

### 7. Browser Use — automação de browser (worker Python, ALTO IMPACTO)

```
GET https://pypi.org/pypi/browser-use/json
  version: 0.13.10 | requires_python: <4.0,>=3.11 | license expr: None (metadata vazio)
  TOTAL deps: 61 — inclui: browser-harness==0.1.13, browser-use-sdk==3.4.2,
    bubus==1.5.6, cdp-use==1.4.5, browser-use-core==0.13.3 (por plataforma:
    darwin arm64/x86_64, linux aarch64/x86_64, win32 AMD64/x86_64)
GET https://api.github.com/repos/browser-use/browser-use/license → spdx_id: MIT
```

- **Consumo recomendado:** worker Python em **uv/venv 3.12** (`>=3.11` ok);
  `browser-use==0.13.10`.
- **Riscos/limites:**
  - **Alto impacto** — efeitos externos (navegação/cliques). Policy Engine deve
    exigir **aprovação humana** antes de execução real.
  - 61 dependências; usa **CDP** (`cdp-use`) e `browser-harness` — pesado. O
    **Chromium NÃO é baixado pelo pip** (instalar/gerenciar à parte; NÃO baixar
    Chromium nesta fase de auditoria).
  - Metadata de licença no PyPI está **vazio**; a licença **MIT** vem do LICENSE do
    repositório (confirmado via GitHub API).

---

## Notas de método / limitações honestas

- `docker manifest inspect` sofreu timeouts intermitentes de TLS ao CDN da Docker;
  a verificação de arquitetura/tags foi feita via **Docker Hub v2 API** e **MCR v2
  API** (equivalentes e mais estáveis), sem baixar camadas.
- SHAs de referência dos componentes foram tomados como já confirmados (enunciado);
  aqui validou-se **como consumir** e **licença**, não a auditoria de conteúdo do código.
- Presidio: a tag de imagem MCR mais recente (2.2.362) está ligeiramente atrás da
  versão pip (2.2.364) — alinhar no deploy.
- Licença do MCP Registry permanece a única pendência bloqueante (NOASSERTION).
