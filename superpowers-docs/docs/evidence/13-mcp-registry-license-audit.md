# Evidência — Auditoria manual da licença do MCP Registry (item 6)

- Repositório: `modelcontextprotocol/registry`
- SHA congelado: `739b70e8bc1bea203c5a35ab699f1df51d091568`
- Arquivo real obtido: `LICENSE` (HTTP 200, 12.227 bytes) — salvo em
  `LICENSES/mcp-registry-LICENSE-739b70e8.txt`
- Método: download do arquivo LICENSE no SHA exato (raw.githubusercontent.com), NÃO apenas
  o campo NOASSERTION da API do GitHub. `LICENSE.md`/`LICENSE.txt` inexistentes; `COPYING` 404.

## Conteúdo verificado (cabeçalho literal do arquivo)

> "The MCP project is undergoing a licensing transition from the MIT License to the Apache
> License, Version 2.0 ("Apache-2.0"). All new code and specification contributions ...
> are licensed under Apache-2.0. Documentation contributions (excluding specifications)
> are licensed under CC-BY-4.0. Contributions for which relicensing consent has been
> obtained are licensed under Apache-2.0. Contributions made by authors who originally
> licensed their work under the MIT License and who have not yet granted explicit
> permission to relicense remain licensed under the MIT License."

O restante do arquivo é o texto integral da **Apache License 2.0**.

## Conclusão da auditoria

- **Licença efetiva:** híbrida — predominantemente **Apache-2.0** (código e specs), com
  **MIT** residual para contribuições ainda não relicenciadas e **CC-BY-4.0** para docs.
  O NOASSERTION do GitHub decorre desse híbrido, não de ausência de licença.
- **Impacto no uso previsto (cliente read-only da API versionada + eventual self-host mirror):**
  Apache-2.0 e MIT são permissivas e compatíveis com o produto. Obrigações: preservar avisos
  de copyright/licença (feito aqui em `LICENSES/`); se reproduzirmos **documentação** do
  Registry, aplicar atribuição **CC-BY-4.0**.
- **Risco:** BAIXO para consumo de API/código. Recomendação: não redistribuir a documentação
  do Registry sem atribuição CC-BY-4.0; ao self-hostar, manter o `LICENSE` do commit fixado.
- **Veredito:** não bloqueia a integração. Requisito atendido sem depender do NOASSERTION.
