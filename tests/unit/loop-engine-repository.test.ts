import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { advance, createLoopRun, proposeStep } from "@omniroute/open-sse/loop-engine/index.ts";

import { getDbInstance } from "@/lib/db/core";
import { getLoopRun, listLoopRuns, LoopRunConflictError, saveLoopRun } from "@/lib/db/loopEngine";

// Garante o schema da migracao 175 no DB isolado do teste (IF NOT EXISTS -> idempotente).
function ensureSchema(): void {
  const sql = readFileSync(
    join(process.cwd(), "src/lib/db/migrations/175_loop_engine_and_buzz_bridge.sql"),
    "utf8"
  );
  getDbInstance().exec(sql);
}

test("loopEngine repo: round-trip persistente cria/salva/carrega", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "daily-triage" });
  proposeStep(run, { title: "revisar issues abertas" });
  saveLoopRun(run);

  const loaded = getLoopRun(run.id);
  assert.ok(loaded, "run deve existir");
  assert.equal(loaded!.pattern, "daily-triage");
  assert.equal(loaded!.status, "report_only");
  assert.equal(loaded!.steps.length, 1);
  assert.equal(loaded!.steps[0].title, "revisar issues abertas");
});

test("loopEngine repo: avanca e persiste o novo estado", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "x" });
  saveLoopRun(run);

  const { run: advanced } = advance(getLoopRun(run.id)!, { policy: { reportOnly: true } });
  saveLoopRun(advanced);

  const reloaded = getLoopRun(run.id)!;
  assert.equal(reloaded.phase, "plan"); // discover -> plan
  assert.equal(reloaded.sequenceNumber, 1);
});

test("loopEngine repo: listLoopRuns encontra o run por status", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "list-test" });
  saveLoopRun(run);
  const found = listLoopRuns("report_only").some((r) => r.id === run.id);
  assert.equal(found, true);
});

test("loopEngine repo: runs sao ISOLADOS por tenant (get/list nao vazam entre tenants)", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "tenant-iso" });
  saveLoopRun(run, "tenantA");
  // Outro tenant NAO enxerga o run
  assert.equal(getLoopRun(run.id, "tenantB"), null);
  assert.equal(
    listLoopRuns(undefined, "tenantB").some((r) => r.id === run.id),
    false
  );
  // O proprio tenant enxerga
  assert.ok(getLoopRun(run.id, "tenantA"));
  assert.ok(listLoopRuns(undefined, "tenantA").some((r) => r.id === run.id));
});

test("loopEngine repo (M2): dois saves a partir do MESMO snapshot -> o segundo falha (guarda otimista)", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "race" });
  saveLoopRun(run);
  const snapshot = getLoopRun(run.id)!; // sequence 0
  const a = advance(snapshot, { policy: { reportOnly: true } }).run; // sequence 1
  const b = advance(snapshot, { policy: { reportOnly: true } }).run; // sequence 1, mesmo snapshot
  saveLoopRun(a);
  assert.throws(() => saveLoopRun(b), LoopRunConflictError);
  const persisted = getLoopRun(run.id)!;
  assert.equal(persisted.sequenceNumber, 1);
  assert.equal(persisted.phase, "plan");
});

test("loopEngine repo (L7): outro tenant com o MESMO id nao sobrescreve o run (clausula de tenant no upsert)", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "tenant-guard" });
  saveLoopRun(run, "tenantA");
  const hijack = advance(run, { policy: { reportOnly: true } }).run; // sequence 1, phase plan
  assert.throws(() => saveLoopRun(hijack, "tenantB"), LoopRunConflictError);
  const kept = getLoopRun(run.id, "tenantA")!;
  assert.equal(kept.sequenceNumber, 0);
  assert.equal(kept.phase, "discover");
  assert.equal(getLoopRun(run.id, "tenantB"), null);
});

test("loopEngine repo (L2): createdAt sobrevive ao round-trip e nao muda no update", () => {
  ensureSchema();
  const run = createLoopRun({ pattern: "created-at" });
  saveLoopRun(run);
  const loaded = getLoopRun(run.id)!;
  assert.equal(loaded.createdAt, run.createdAt);
  saveLoopRun(advance(loaded, { policy: { reportOnly: true } }).run);
  assert.equal(getLoopRun(run.id)!.createdAt, run.createdAt);
});
