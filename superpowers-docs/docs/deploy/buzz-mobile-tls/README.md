# Acesso mobile ao Buzz (falar com os agentes pelo celular) — TLS grátis

Objetivo: expor o relay Buzz self-hosted em `wss://SEU_DOMINIO` para o app mobile Nostr
conectar e você conversar com os agentes do OmniRoute pelo celular. **Tudo grátis** (Caddy +
Let's Encrypt). Aditivo: não altera o compose do Buzz.

## Por que precisa de domínio (e não bastava túnel/IP)

O relay Buzz **resolve a comunidade pelo cabeçalho `Host`**. Um túnel genérico ou `127.0.0.1`
chega com um Host que não corresponde a nenhuma comunidade registrada → **404**. A solução é um
**host público estável** (domínio) usado tanto para registrar a comunidade quanto no `Host` que
chega ao relay. O `Caddyfile` aqui encaminha o Host público (`header_up Host {host}`) exatamente
por isso.

## Pré-requisitos

- Um domínio (ex.: `relay.seu-dominio.com`) com registro **A/AAAA** apontando para o IP público
  do servidor onde o relay Buzz roda.
- Portas **80 e 443** abertas nesse servidor (ACME HTTP-01 + tráfego TLS).
- O stack do Buzz já rodando via `deploy/compose` (relay na rede `buzz-net`, porta interna 3000).

## Passos

1. Copie os arquivos para o diretório `deploy/compose` do Buzz:
   ```bash
   cp <repo>/docs/deploy/buzz-mobile-tls/Caddyfile ./Caddyfile
   cp <repo>/docs/deploy/buzz-mobile-tls/compose.caddy.yml ./compose.caddy.yml
   cp <repo>/docs/deploy/buzz-mobile-tls/.env.caddy.example ./.env.caddy
   ```
2. Edite `.env.caddy` com seu domínio e e-mail ACME.
3. Suba o Caddy na MESMA invocação do compose (para compartilhar a rede `buzz-net`):
   ```bash
   docker compose -f compose.yml -f compose.caddy.yml --env-file .env.caddy up -d caddy
   ```
   O Caddy emite o certificado sozinho no primeiro acesso (aguarde ~30s).
4. Verifique o certificado TLS (HEAD simples, sem upgrade de WS):
   ```bash
   curl -sI https://SEU_DOMINIO | head -n1          # espera 200/404/426 (TLS OK)
   ```
   Para testar o upgrade WebSocket de fato, use um cliente WS (ex.: `websocat wss://SEU_DOMINIO`)
   ou o próprio app mobile — um `curl -I` não envia o cabeçalho `Upgrade` e não retorna 101.
5. **Registre a comunidade sob o host público** (o `Host` = seu domínio). Use o mesmo
   procedimento de criação de comunidade do Buzz, porém com o host = `SEU_DOMINIO` (não
   `localhost`). É isso que faz o relay resolver a comunidade quando o app conectar.

## No OmniRoute (painel único)

Em **Buzz Hub** (`/dashboard/buzz`), você pode manter o relay local (`ws://localhost:3000`) para
o servidor e usar o domínio público só para o celular — ou apontar o OmniRoute para
`wss://SEU_DOMINIO` no mesmo campo (precedência painel → env → default).

## No celular

Abra um cliente Nostr compatível, adicione o relay `wss://SEU_DOMINIO`, entre na comunidade e
converse. As mensagens do agente saem pelo outbox do OmniRoute (idempotente) e chegam ao relay;
as suas chegam pelo inbox. **A chave Nostr nunca autoriza uma ação no OmniRoute** — mensagens são
colaboração, não comando privilegiado.

## Segurança

- Mantenha `auth_required`/`restricted_writes` do relay conforme seu `.env` do Buzz.
- Não versione `.env.caddy` nem segredos. Só as portas 80/443 ficam públicas; postgres/redis/minio
  permanecem internos à `buzz-net`.
