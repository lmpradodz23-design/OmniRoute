import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { advance, createLoopRun, proposeStep } from "@omniroute/open-sse/loop-engine/index.ts";

import { getDbInstance } from "@/lib/db/core";
import { getLoopRun, listLoopRuns, saveLoopRun } from "@/lib/db/loopEngine";

// Garante o schema da migracao 175 no DB isolado do teste (IF NOT EXISTS -> idempotente).
function ensureSchema(): void {
  const sql = readFileSync(
    join(process.cwd(), "src/lib/db/migrations/174_loop_engine_and_buzz_bridge.sql"),
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
