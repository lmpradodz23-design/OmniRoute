# Finding #6 — Servidor remoto recebe credenciais pelo IPC privilegiado do Electron

- **Severidade:** high · **CWE-346/749/862** · broken-access-control
- **Arquivos:** `electron/main.js` (handler `login:start`), novo `electron/lib/ipcOriginGuard.js`

## Causa raiz
No modo Remote Server, a MESMA janela (com o preload privilegiado `electronAPI`) carrega uma URL
HTTP(S) arbitrária. Os handlers IPC não validavam origem/sender, e `login:start` **devolvia
`result.credentials` ao renderer** — uma página remota/comprometida chamava `startLogin` e recebia
tokens/cookies de provedores.

## Correção (o que foi feito e verificado aqui)
- Novo módulo puro `electron/lib/ipcOriginGuard.js` (sem import de electron, testável):
  - `isLoopbackHostname`, `isPrivilegedSenderAllowed(senderUrl)` (nega origem de rede http(s)
    NÃO-loopback; permite loopback/file/app/about — conteúdo local), `isCrossOriginNavigation`.
- `main.js` `login:start`:
  - **rejeita sender não-local** (`isPrivilegedSenderAllowed(event.senderFrame.url)`) — uma página
    remota não aciona mais o login/extração;
  - **valida `providerId`** (tipo/tamanho);
  - **nunca retorna credentials** ao renderer — as credenciais são persistidas só no processo
    principal e o retorno é sanitizado (`credentials` removido; `credentialsPersisted: boolean`).

## Testes — `tests/unit/electron-ipc-origin-guard.test.ts`
- guards puros: loopback vs remoto; `isPrivilegedSenderAllowed` permite local (loopback/file/app/
  about/vazio) e **NEGA** `https://evil…`, `http://192.168…`, `https://omniroute.dz23.online`;
  cross-origin nav detectada.
- estáticos no `main.js`: o handler `login:start` chama o guard e **não** faz `return result;` cru
  (strip de credentials presente).

## Resultado (evidência real)
- `node --test` (arquivo novo): **7/7**.
- Regressão: `electron-remote-server.test.ts` **25/25** (sem quebra).
- `eslint`: exit 0 (arquivos electron são ignorados pelo config; o teste `.ts` passa).
- `node --check electron/main.js` e `ipcOriginGuard.js`: **sintaxe válida**.

## Pendente — BLOCKED_BY_EXTERNAL (gate "testes Electron", precisa de build + runtime Electron)
Não verificável neste ambiente (sem binário Electron):
- **Janela/preload SEPARADOS** para o modo remoto (renderer remoto sem nenhum IPC privilegiado);
- bloqueio de `will-navigate`/`will-redirect`/subframes e navegação cross-origin (helper
  `isCrossOriginNavigation` já pronto para o wiring);
- **HTTPS obrigatório** para hosts não-loopback (mantido permissivo aqui para não quebrar o fluxo
  de conexão/testes existentes; o guard de sender já bloqueia IPC privilegiado de qualquer origem
  remota, HTTP incluso);
- `sandbox: true` na janela principal;
- validar `sender.id` além do `senderFrame.url`.
Esses itens exigem execução E2E do app Electron para verificação segura.
