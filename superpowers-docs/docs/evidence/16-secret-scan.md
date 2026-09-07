# Evidência — Secret scan pré-commit (item 9)

- Escopo: todos os arquivos de `docs/` e `LICENSES/` + `THIRD_PARTY_NOTICES.md` (28 arquivos).
- Padrões: OpenAI/Anthropic (`sk-`,`sk-ant-`), AWS (`AKIA…`), Google (`AIza…`), Slack (`xox…`),
  GitHub (`ghp_…`), chaves privadas PEM, JWT (`eyJ….….…`).
- **Resultado: 0 segredos detectados.**
- `repos/`, `tmp/`, `node_modules/`, `.venv/` estão no `.gitignore` e NÃO são commitados
  (incluindo o `.env` que o OmniRoute cria em `repos/OmniRoute` a partir de `.env.example`).

## Segundo scan — reconciliação (pós-95eff9f)

- Escopo ampliado: **todos os arquivos rastreados** (`git ls-files`) + **diff do working tree**.
- Motivo: `_omni-verify4.log` foi alterado por término tardio de processo (evid. 15 adendo).
- **Resultado: 0 segredos** nos arquivos rastreados e **0** nas linhas adicionadas do diff.
