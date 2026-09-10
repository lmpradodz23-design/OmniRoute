# ROLLBACK — OmniRoute v3.8.51 (fork `LMPrado-DZ23/OmniRoute`)

Procedimentos de reversão **testados** para cada camada do produto, na ordem em que um
operador precisa deles. Cada procedimento indica o que é revertido, o que **não** é, o
comando e a evidência (teste automatizado ou verificação manual) que o sustenta.

Regra geral: **os dados vivem em `DATA_DIR`** (`~/.omniroute` por padrão; volume Docker;
`userData` do Electron). Reverter a _aplicação_ nunca apaga `DATA_DIR`; reverter o _banco_
é uma operação separada, explícita, sempre a partir de um snapshot verificado.

## 1. Banco de dados (migrations) — R-1

|                        |                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quando                 | Uma atualização falhou ao aplicar uma migration (o servidor não sobe) ou a versão nova se mostrou inaceitável depois de migrar.                                                                                                                                                                                                                                                              |
| Mecanismo              | Migrations são **forward-only** (sem `down`). Antes de tocar um banco existente o runner grava um snapshot **content-addressed** em `DATA_DIR/db_backups/db_state-<sha256>_pre-migration.sqlite` e recusa migrar se ele mudar antes do uso (`migrationRunner.ts`). Cada migration roda em transação própria: uma falha não deixa DDL parcial nem registro no ledger `_omniroute_migrations`. |
| O que a falha informa  | O erro original do SQLite **+ `Restore point (pre-migration snapshot, sha256 …): <caminho>`** com as três formas de restaurar (`describeRestorePoint`). O banco é **fechado** ao falhar, para que o arquivo possa ser substituído na hora (Windows/Electron).                                                                                                                                |
| Verificação no restore | `restoreDbBackup` re-calcula o SHA-256 do snapshot e **recusa** um arquivo cujo conteúdo não bate com o nome, além do `PRAGMA integrity_check`.                                                                                                                                                                                                                                              |

Procedimento:

1. Ler a linha `Restore point` do log de startup (ou `omniroute logs`).
2. Restaurar por **uma** das vias:
   - Dashboard → Storage → Backups → Restore `db_state-<sha256>_pre-migration.sqlite`;
   - `POST /api/db-backups` `{"backupId":"db_state-<sha256>_pre-migration.sqlite"}` (auth de gestão);
   - offline: parar o OmniRoute, copiar o snapshot sobre `DATA_DIR/storage.sqlite`, remover `storage.sqlite-wal` e `storage.sqlite-shm`.
3. **Voltar à versão anterior da aplicação** (§2) antes de subir de novo — a versão nova
   reaplicaria a mesma migration.
4. Se o snapshot vier de um banco cujo ledger foi apagado, o guard de migração em massa pode
   abortar; a mensagem indica `OMNIROUTE_MAX_PENDING_MIGRATIONS=0` como bypass consciente.

Evidência: `tests/unit/db-migration-rollback-restore-point.test.ts` (2/2) — uma migration
quebrada aborta o startup nomeando o snapshot exato; o banco fica livre; o restore devolve o
estado do operador sem a DDL nem o registro da migration; um snapshot com bytes diferentes
do nome é recusado e o banco vivo permanece intacto. Regressão:
`db-migration-runner`, `db-pre-migration-backup-retention-10421`, `db-backup-extended`,
`db-core-migration`, `db-migration-runner-extra-dirs`, `db-migration-missing-physical-schema`
(todos PASS após a mudança). Documentação do operador:
`docs/ops/DATABASE_GUIDE.md` § "Rolling back a failed migration".

Não coberto: reverter uma migration **já aplicada com sucesso** sem snapshot (não existe
`down`); a única via é um backup manual/agendado anterior (`omniroute backup`,
`/api/db-backups` PUT) — por isso o snapshot pré-migração é obrigatório e nunca é apagado
dentro da janela de migração (#10421).

## 2. Aplicação

### 2.1 npm (CLI/servidor global)

```bash
omniroute --version                      # versão atual
npm install -g omniroute@<versão-anterior>
omniroute --version                      # confirma
omniroute start                          # ou o serviço/pm2 usado
```

`DATA_DIR` não é tocado. O comando `omniroute update` só aceita releases cujo
`repository.url` seja o nosso repositório (`src/shared/constants/distribution.ts`,
`bin/cli/commands/update.mjs`), então uma versão do upstream nunca é oferecida como "update".

### 2.2 Docker / Compose (GHCR)

```bash
docker pull ghcr.io/lmprado-dz23/omniroute:<versão-anterior>
# compose: apontar `image:` para a tag (ou para o digest) anterior
docker compose up -d
docker compose logs -f omniroute        # aguardar "[DB] Driver:" e "/health" 200
```

Tags de versão nunca são reescritas (`docs/ops/RELEASE_CHECKLIST.md`): reverter `latest` é
apontá-lo para o digest anterior. O volume de dados permanece; se a versão nova migrou o
banco, aplicar §1 **antes** de subir a anterior.

### 2.3 Electron (desktop)

`electron-updater` roda com `autoDownload=false`: nada é instalado sem clique. Para reverter,
desinstalar e instalar o instalador da release anterior em
`https://github.com/LMPrado-DZ23/OmniRoute/releases`. `userData` (banco, `server.env`,
credenciais) é preservado. **Gap conhecido (E-5, Fase 5):** o updater ainda não grava um
snapshot próprio antes de trocar a versão; o snapshot pré-migração de §1 cobre o banco, mas
não uma versão nova que corrompa configuração sem migrar — mitigação: `omniroute backup
create` antes de aceitar a atualização.

### 2.4 Código-fonte (checkout)

```bash
git log --oneline -5
git checkout <tag-ou-commit-anterior>
npm ci && npm run build
```

## 3. Configuração

- `DATA_DIR/server.env` e `settings` no banco: o dashboard grava com controle de revisão
  (`SETTINGS_REVISION_CONFLICT` em `src/app/api/settings/route.ts`), então uma edição
  concorrente é recusada em vez de sobrescrever. Não há versionamento histórico: para
  reverter, restaurar o backup completo (`omniroute backup create` gera
  `backups/omniroute-backup-<id>/` com `storage.sqlite`, `settings.json`, `combos.json`,
  `providers.json`; `omniroute restore <id>`).
- Login obrigatório / senha de gestão: `POST /api/auth/require-login` exige senha para
  ativar; para desativar em recuperação local, ver `docs/security` (LOCAL_ONLY + loopback).

## 4. Release (GitHub / npm / GHCR)

Segue `docs/ops/RELEASE_CHECKLIST.md` § Rollback: marcar a release como pre-release
(`gh release edit vX.Y.Z --prerelease`), `npm deprecate` como primeiro reflexo (nunca
`unpublish` fora da janela), nunca reescrever tag Docker — repontar `latest`. Nenhuma dessas
ações foi executada nesta missão (publicação condicionada a COMPLETED + autorização).

## 5. Verificação após qualquer rollback

1. `GET /health` → 200 e `GET /api/version` mostra a versão esperada.
2. Log de startup sem `[Migration] FAILED` e com `[DB] Driver: … | file: …`.
3. Dashboard → Storage: contagem de conexões/combos/chaves igual à anterior
   (`restoreDbBackup` devolve `connectionCount`, `comboCount`, `apiKeyCount`).
4. Uma chamada real `POST /v1/chat/completions` (ou `/v1/messages`) pelo cliente habitual.

## Gate da missão

`rollback = PASS` para banco (§1, testado) e aplicação npm/Docker/fonte (§2, procedimentos
documentados sobre mecanismos existentes e verificados: tags imutáveis, `DATA_DIR` intacto,
gate de `repository.url`). **Parcial** para Electron (E-5: sem snapshot próprio pré-update;
mitigação documentada). Última atualização: 2026-09-10.
