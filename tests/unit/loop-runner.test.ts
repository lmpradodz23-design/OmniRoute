import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getDbInstance } from "@/lib/db/core";
import { pendingOutbox } from "@/lib/db/buzzBridge";
import { addStep, advanceRun, approveStep, runsAwaitingApproval, startRun } from "@/lib/loopRunner";

function ensureSchema(): void {
  const sql = readFileSync(
    join(process.cwd(), "src/lib/db/migrations/174_loop_engine_and_buzz_bridge.sql"),
    "utf8"
  );
  getDbInstance().exec(sql);
}

/** Avança até ENTRAR na fase execute (discover→plan→split→execute = 3 avanços). */
function advanceToExecute(runId: string) {
  advanceRun(runId); // -> plan
  advanceRun(runId); // -> split
  return advanceRun(runId); // -> execute (fase atual = execute)
}

test("loopRunner: start -> advance persiste e progride (discover->plan)", () => {
  ensureSchema();
  const run = startRun({ pattern: "daily-triage" });
  const { run: after } = advanceRun(run.id);
  assert.equal(after.phase, "plan");
  assert.equal(after.sequenceNumber, 1);
});

test("loopRunner: efeito proposto para em awaiting_approval; approveStep libera", () => {
  ensureSchema();
  const run = startRun({ pattern: "pr-babysitter" });
  const withStep = addStep(run.id, {
    title: "abrir PR",
    proposedEffect: { kind: "git_pr", summary: "PR #1" },
  });
  const stepId = withStep.steps[0].id;

  const atExecute = advanceToExecute(run.id);
  assert.equal(atExecute.run.phase, "execute");

  // proximo advance ENTRA em execute -> o gate segura o efeito proposto
  const gated = advanceRun(run.id);
  assert.equal(gated.run.status, "awaiting_approval");
  assert.ok(runsAwaitingApproval().some((r) => r.id === run.id));

  // aprovacao humana explicita libera o run
  const freed = approveStep(run.id, stepId);
  assert.equal(freed.status, "report_only");
  assert.equal(freed.steps[0].status, "approved");
});

test("loopRunner: transição para awaiting_approval enfileira aviso no outbox do Buzz (produtor)", () => {
  ensureSchema();
  const run = startRun({ pattern: "pr-babysitter" });
  addStep(run.id, { title: "abrir PR", proposedEffect: { kind: "git_pr", summary: "PR" } });
  advanceToExecute(run.id);
  advanceRun(run.id); // ENTRA em awaiting_approval -> dispara o produtor (durável no outbox)
  const pend = pendingOutbox();
  assert.ok(
    pend.some((e) => e.runId === run.id && e.event.content.includes("awaiting_approval")),
    "deve haver um aviso do Loop no outbox do Buzz"
  );
});

test("loopRunner: efeito destrutivo e NEGADO (deny) -> run failed", () => {
  ensureSchema();
  const run = startRun({ pattern: "danger" });
  addStep(run.id, { title: "apagar", proposedEffect: { kind: "delete", summary: "rm -rf" } });
  advanceToExecute(run.id);
  const gated = advanceRun(run.id); // entra execute -> deny (destrutivo nunca autonomo)
  assert.equal(gated.run.status, "failed");
});
