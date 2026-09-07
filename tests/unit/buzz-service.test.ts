import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getDbInstance } from "@/lib/db/core";
import { flushBuzzOutbox, getBuzzConfig, getOrCreateAgentSecretKey } from "@/lib/buzzService";

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

test("buzzService: getBuzzConfig usa default localhost:3000", () => {
  ensureSchema();
  const cfg = getBuzzConfig();
  assert.match(cfg.relayUrl, /^ws:\/\//);
  assert.equal(cfg.secretKeyHex.length, 64);
});

test("buzzService: flushBuzzOutbox e SKIPPED quando a flag BUZZ_HUB_ENABLED esta OFF", async () => {
  ensureSchema();
  const res = await flushBuzzOutbox();
  assert.equal(res.skipped, true);
  assert.equal(res.published, 0);
});
