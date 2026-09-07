| Componente                      | Repo                                             | SHA            | Data commit          | Licença atual | Papel                                      |
| ------------------------------- | ------------------------------------------------ | -------------- | -------------------- | ------------- | ------------------------------------------ |
| OmniRoute (base)                | `diegosouzapw/OmniRoute`                         | `f9a1cc8a9b73` | 2026-09-06T02:32:26Z | MIT           | serviço/produto principal                  |
| codex-chatgpt-web (base)        | `miuuyy/codex-chatgpt-web`                       | `c648c09501bb` | 2026-09-05T21:28:13Z | MIT           | provedor interno supervisionado            |
| Presidio                        | `data-privacy-stack/presidio`                    | `5e2fcea990aa` | 2026-09-06T09:57:47Z | MIT           | Security Shield (serviço isolado)          |
| MCP Registry                    | `modelcontextprotocol/registry`                  | `739b70e8bc1b` | 2026-09-05T22:13:09Z | NOASSERTION   | descoberta MCP (API versionada, read-only) |
| MarkItDown                      | `microsoft/markitdown`                           | `4459ed01155f` | 2026-09-04T17:04:57Z | MIT           | Knowledge Hub (worker Python sandbox)      |
| Qdrant                          | `qdrant/qdrant`                                  | `6ab21cac18eb` | 2026-09-03T12:36:18Z | Apache-2.0    | índice vetorial (serviço Docker)           |
| OpenTelemetry Collector Contrib | `open-telemetry/opentelemetry-collector-contrib` | `4a07b72915f1` | 2026-09-06T14:17:37Z | Apache-2.0    | observabilidade (serviço)                  |
| AG-UI                           | `ag-ui-protocol/ag-ui`                           | `54c155826620` | 2026-09-04T20:37:26Z | MIT           | protocolo/lib de eventos                   |
| Browser Use                     | `browser-use/browser-use`                        | `e25ab65e699a` | 2026-09-05T17:28:28Z | MIT           | automação de browser (worker Python)       |

### Mensagem do commit congelado (1ª linha)

- **OmniRoute (base)**: fix: resolve SqliteError no such table compression_run_telem
- **codex-chatgpt-web (base)**: release: v5.0.4
- **Presidio**: fix(anonymizer): bump cryptography to >=50.0.0 for GHSA-g6cj
- **MCP Registry**: fix: fail safely in registry admin scripts (#1622)
- **MarkItDown**: fix(pptx): chart_title.text_frame is never None -- use has_t
- **Qdrant**: Bump version to 1.19.1 (#10463)
- **OpenTelemetry Collector Contrib**: [chore] [processor/adaptivetailsampling] Fix flaky TestProce
- **AG-UI**: Merge pull request #2645 from ag-ui-protocol/ben1/fastapi-en
- **Browser Use**: fix: honor MCP disable security environment setting (#5695)
