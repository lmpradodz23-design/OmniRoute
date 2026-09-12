import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { BuzzEvent } from "@omniroute/open-sse/buzz-bridge/index.ts";

import { getDbInstance } from "@/lib/db/core";
import { enqueueOutbox } from "@/lib/db/buzzBridge";
import {
  flushBuzzOutbox,
  getBuzzConfig,
  getBuzzRelayUrl,
  getBuzzStatus,
  getOrCreateAgentSecretKey,
  setBuzzRelayUrl,
} from "@/lib/buzzService";

function ensureSchema(): void {
  const sql = readFileSync(
    join(process.cwd(), "src/lib/db/migrations/175_loop_engine_and_buzz_bridge.sql"),
    "utf8"
  );
  getDbInstance().exec(sql);
  // key_value pode nao existir num DB minimo de teste; garante.
  getDbInstance().exec(
    "CREATE TABLE IF NOT EXISTS key_value (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY(namespace,key))"
  );
}

test("buzzService: chave do agente e gerada e PERSISTIDA (estavel entre chamadas)", () => {
  ensureSchema();
  const k1 = getOrCreateAgentSecretKey();
  const k2 = getOrCreateAgentSecretKey();
  assert.equal(k1.length, 64);
  assert.equal(k1, k2); // persistida, nao regenerada
});

test("buzzService: getBuzzConfig sem relay configurado -> relayUrl vazia (ponte desligada)", () => {
  ensureSchema();
  delete process.env.BUZZ_RELAY_URL;
  const cfg = getBuzzConfig();
  assert.equal(cfg.relayUrl, ""); // sem default implicito (ws://localhost:3000 colidia com o Next)
  assert.equal(cfg.secretKeyHex.length, 64);
});

test("buzzService: flushBuzzOutbox e SKIPPED quando a flag BUZZ_HUB_ENABLED esta OFF", async () => {
  ensureSchema();
  const res = await flushBuzzOutbox();
  assert.equal(res.skipped, true);
  assert.equal(res.published, 0);
});

test("buzzService: getBuzzStatus reporta flag OFF, pubkey 64-hex e contagens do painel", () => {
  ensureSchema();
  getOrCreateAgentSecretKey(); // identidade ja criada: com a flag OFF o status apenas a reporta
  const id = "evt-" + Math.random().toString(36).slice(2);
  const ev: BuzzEvent = { id, pubkey: "npub_t", kind: 1, createdAt: 1, tags: [], content: "c" };
  enqueueOutbox({ event: ev, correlationId: "c1" });

  const s = getBuzzStatus();
  assert.equal(s.enabled, false); // flag OFF por padrao
  assert.match(s.agentPubkey ?? "", /^[0-9a-f]{64}$/); // chave PUBLICA, nunca a secreta
  assert.notEqual(s.agentPubkey, getOrCreateAgentSecretKey()); // publica != secreta
  assert.equal(s.identityStatus, "ok");
  assert.ok(s.counts.outboxPending >= 1); // enfileirado acima aparece como pendente
});

test("buzzService: setBuzzRelayUrl (painel) tem precedencia; vazio volta ao env/default (vazio)", () => {
  ensureSchema();
  delete process.env.BUZZ_RELAY_URL;
  assert.equal(setBuzzRelayUrl("wss://relay.exemplo:7000"), "wss://relay.exemplo:7000");
  assert.equal(getBuzzRelayUrl(), "wss://relay.exemplo:7000");
  assert.equal(getBuzzConfig().relayUrl, "wss://relay.exemplo:7000"); // config usa o override
  assert.equal(getBuzzStatus().relayConfigured, true);
  setBuzzRelayUrl(""); // limpa -> volta ao env/default
  assert.equal(getBuzzRelayUrl(), "");
  assert.equal(getBuzzStatus().relayConfigured, false);
});
