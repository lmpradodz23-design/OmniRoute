# Evidência — Build do OmniRoute bloqueado por toolchain nativo (Windows)

## Fato

O build do OmniRoute exige dependências NATIVAS (optionalDependencies):
`better-sqlite3`, `sqlite-vec`, `keytar`, `wreq-js`, `@huggingface/transformers`.

Duas camadas de problema, ambas reais e reproduzidas:

1. **npm 11 pula install-scripts de optionalDependencies por padrão** e ainda sai 0 —
   então um `npm ci`/`npm install` "aparenta sucesso" sem os nativos. O próprio OmniRoute
   detecta isso em `scripts/check/check-native-deps.mjs` e falha o build com mensagem clara.
2. **Sem compilar tampouco:** ao forçar `--include=optional --foreground-scripts`, o
   `node-gyp@12.4.0` achou Python 3.12, mas falhou em achar o compilador:
   `gyp ERR! find VS Could not find any Visual Studio installation to use` /
   "You need ... Visual Studio including the 'Desktop development with C++' workload".
   → Não há toolchain MSVC nesta máquina; prebuilt binaries não cobriram Node 24 para
   esses pacotes, então o node-gyp caiu para compilação de fonte e falhou.

## Conclusão (baseline)

- **Instalação de dependências JS (incl. devDeps): OK** após corrigir o `npm dev=false`
  com `--include=dev`.
- **Build de produção do OmniRoute: BLOQUEADO nesta máquina** por ausência de toolchain
  C++ (MSVC "Desktop development with C++"). É falha **ambiental/pré-existente**, não do
  código do OmniRoute.
- **Remediações possíveis (fora do escopo da Fase 0, exigem sua decisão/ação):**
  (a) instalar "Visual Studio Build Tools" + workload C++ e reinstalar com scripts aprovados; ou
  (b) usar prebuilds/perfil Docker (o `docker-compose.yml` do OmniRoute já provê imagens que
  trazem os nativos prontos) — caminho recomendado para reprodutibilidade.
- Escape hatch `OMNIROUTE_SKIP_NATIVE_DEP_CHECK=1` só ignora a checagem; não resolve a
  ausência real dos módulos, então o build ainda falharia adiante.
