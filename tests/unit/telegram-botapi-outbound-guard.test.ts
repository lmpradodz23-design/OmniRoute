/**
 * Regression for SSRF finding S-6 (Fase 1): the Telegram Bot API client. The base URL is
 * operator data (`TELEGRAM_BOT_API_BASE`, e.g. a self-hosted Bot API server) and the bot token
 * is part of the request PATH, so two things must hold:
 *  - the request goes through the pinned guarded client (metadata never, redirects never
 *    followed, private only under the integration policy);
 *  - a guard decision is reported WITHOUT the URL — the guard's own message embeds the full
 *    target, which here contains the bot token.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, afterEach, before } from "node:test";

const TOKEN = "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const savedEnv = { base: process.env.TELEGRAM_BOT_API_BASE, token: process.env.TELEGRAM_BOT_TOKEN };

let server: Server;
let base = "";
let hits: Array<{ url: string; body: string }> = [];
let mode: "ok" | "redirect" | "fail" = "ok";

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      hits.push({ url: req.url ?? "", body: raw });
      if (mode === "redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:9/internal" });
        return res.end();
      }
      if (mode === "fail") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: { message_id: 7, chat: { id: 1, type: "private" }, text: "hi" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (savedEnv.base === undefined) delete process.env.TELEGRAM_BOT_API_BASE;
  else process.env.TELEGRAM_BOT_API_BASE = savedEnv.base;
  if (savedEnv.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = savedEnv.token;
});

afterEach(() => {
  hits = [];
  mode = "ok";
});

const botApi = await import("../../src/lib/telegram/botApi.ts");

test("S-6 telegram: sendMessage reaches the configured base with the token path and JSON body", async () => {
  process.env.TELEGRAM_BOT_API_BASE = base;
  const msg = await botApi.sendTelegramMessage({ chat_id: 1, text: "hi" });
  assert.equal(msg.message_id, 7);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, `/bot${TOKEN}/sendMessage`);
  assert.deepEqual(JSON.parse(hits[0].body), { chat_id: 1, text: "hi" });
});

test("S-6 telegram: a Bot API error keeps its description (no token in the message)", async () => {
  process.env.TELEGRAM_BOT_API_BASE = base;
  mode = "fail";
  await assert.rejects(
    botApi.sendTelegramMessage({ chat_id: 1, text: "hi" }),
    (e: unknown) => e instanceof Error && /chat not found/.test(e.message) && !e.message.includes(TOKEN)
  );
});

test("S-6 telegram: a cloud-metadata base is blocked before any socket and the token never leaks", async () => {
  process.env.TELEGRAM_BOT_API_BASE = "http://169.254.169.254";
  await assert.rejects(
    botApi.sendTelegramMessage({ chat_id: 1, text: "hi" }),
    (e: unknown) =>
      e instanceof Error && /blocked/i.test(e.message) && !e.message.includes(TOKEN) && !/169\.254/.test(e.message)
  );
});

test("S-6 telegram: a redirect from the Bot API is never followed and the token never leaks", async () => {
  process.env.TELEGRAM_BOT_API_BASE = base;
  mode = "redirect";
  await assert.rejects(
    botApi.setTelegramWebhook("https://example.com/hook"),
    (e: unknown) => e instanceof Error && /blocked/i.test(e.message) && !e.message.includes(TOKEN)
  );
  assert.equal(hits.length, 1);
});
