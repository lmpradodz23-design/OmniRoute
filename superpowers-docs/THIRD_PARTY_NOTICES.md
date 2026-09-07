# THIRD PARTY NOTICES — OmniRoute Unified

Este produto integra componentes de terceiros. Avisos de copyright, licenças e autoria
são preservados aqui e em `LICENSES/`. SHAs congelados verificados em 2026-09-06.

## Projetos-base

| Projeto           | Repositório                | SHA congelado                                        | Licença                                        |
| ----------------- | -------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| OmniRoute         | `diegosouzapw/OmniRoute`   | `f9a1cc8a9b7336e394ef921c753f5da691798df9` (v3.8.51) | MIT (`LICENSES/OmniRoute-LICENSE.txt`)         |
| codex-chatgpt-web | `miuuyy/codex-chatgpt-web` | `c648c09501bb1b704c7ad5273fb5f5d6b8992dd2` (v5.0.4)  | MIT (`LICENSES/codex-chatgpt-web-LICENSE.txt`) |

> Nota: o OmniRoute já vendoriza `codex-chatgpt-web` **v4.0.7** (commit `b59d7dc5`) em
> `open-sse/vendor/codex-chatgpt-web/`, com atribuição no `THIRD_PARTY_NOTICES.md` do
> próprio OmniRoute. A base congelada v5.0.4 é mais nova; adoção do delta exige
> re-auditoria (ver ADR-001).

## Componentes adicionais (forma de consumo: serviço/lib/worker — não copiados integralmente)

| Componente                      | Repositório                                      | SHA de referência                                    | Licença                                                                      | Papel                               |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| Presidio                        | `data-privacy-stack/presidio`                    | `5e2fcea990aa3b99660d2aea9121d0ba74a8940b`           | MIT                                                                          | Security Shield                     |
| MCP Registry                    | `modelcontextprotocol/registry`                  | `739b70e8bc1bea203c5a35ab699f1df51d091568`           | **NOASSERTION → auditoria manual** (transição p/ Apache-2.0; docs CC-BY-4.0) | Descoberta MCP                      |
| MarkItDown                      | `microsoft/markitdown`                           | `4459ed01155f8e1a7ac007f441d34f0422746191`           | MIT                                                                          | Knowledge Hub                       |
| Qdrant                          | `qdrant/qdrant`                                  | `6ab21cac18ebb6f4ae29102c7f8f5cc11affd5de` (v1.19.1) | Apache-2.0                                                                   | Índice vetorial                     |
| OpenTelemetry Collector Contrib | `open-telemetry/opentelemetry-collector-contrib` | `4a07b72915f1980914b960938fda36fd2873b9ef`           | Apache-2.0                                                                   | Observabilidade                     |
| AG-UI                           | `ag-ui-protocol/ag-ui`                           | `54c155826620892610d6f9cc0d697d0c6f70ae7c`           | MIT                                                                          | Protocolo/eventos                   |
| Browser Use                     | `browser-use/browser-use`                        | `e25ab65e699af3031a1f2d348526de2844be0e89`           | MIT                                                                          | Automação de browser (alto impacto) |

## Pendências de licença

- **MCP Registry:** confirmar SPDX final (Apache-2.0) e licença da documentação (CC-BY-4.0)
  antes de qualquer uso; registrar o arquivo LICENSE do commit fixado em `LICENSES/`.
- Ao consumir imagens Docker (Qdrant, OTel, Presidio) e pacotes (MarkItDown, Browser-Use,
  AG-UI), anexar as respectivas licenças em `LICENSES/` na fase em que forem introduzidos.
