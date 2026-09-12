import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getDbInstance } from "@/lib/db/core";
import { pendingOutbox } from "@/lib/db/buzzBridge";
import { LoopRunConflictError } from "@/lib/db/loopEngine";
import {
  addStep,
  advanceRun,
  approveStep,
  getLoopRun,
  listLoopRuns,
  LoopStateError,
  rejectStep,
  startRun,
} from "@/lib/loopRunner";

function ensureSchema(): void {
  const sql = readFileSync(
    join(process.cwd(), "src/lib/db/migrations/175_loop_engine_and_buzz_bridge.sql"),
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
  assert.ok(listLoopRuns("awaiting_approval").some((r) => r.id === run.id));

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

test("loopRunner (L1): rejectStep + advance -> escalated (handoff humano), nao volta a report_only", () => {
  ensureSchema();
  const run = startRun({ pattern: "reject-me" });
  const withStep = addStep(run.id, {
    title: "abrir PR",
    proposedEffect: { kind: "git_pr", summary: "PR" },
  });
  advanceToExecute(run.id);
  const gated = advanceRun(run.id);
  assert.equal(gated.run.status, "awaiting_approval");

  const rejected = rejectStep(run.id, withStep.steps[0].id);
  assert.equal(rejected.steps[0].status, "rejected");

  const { run: after } = advanceRun(run.id);
  assert.equal(after.status, "escalated");
  assert.equal(getLoopRun(run.id)!.status, "escalated");
});

test("loopRunner (M2): expectedSequenceNumber desatualizado -> LoopRunConflictError e nada e gravado", () => {
  ensureSchema();
  const run = startRun({ pattern: "stale-writer" });
  const first = advanceRun(run.id, { expectedSequenceNumber: 0 });
  assert.equal(first.run.sequenceNumber, 1);
  // um segundo escritor que partiu do mesmo snapshot (sequence 0) perde a corrida
  assert.throws(() => advanceRun(run.id, { expectedSequenceNumber: 0 }), LoopRunConflictError);
  const persisted = getLoopRun(run.id)!;
  assert.equal(persisted.sequenceNumber, 1);
  assert.equal(persisted.phase, "plan");
});

test("loopRunner (L2): teto de tempo e imposto pelo motor mesmo sem consumed do chamador", () => {
  ensureSchema();
  const run = startRun({ pattern: "slow", budget: { maxWallClockMs: 1 } });
  const { run: after } = advanceRun(run.id, { now: run.createdAt + 5_000 });
  assert.equal(after.status, "aborted");
});

test("loopRunner (B-H3): approveStep reavalia o gate — efeito destrutivo (purchase/delete) NUNCA vira approved", () => {
  ensureSchema();
  const run = startRun({ pattern: "approve-gate" });
  addStep(run.id, { title: "abrir PR", proposedEffect: { kind: "git_pr", summary: "PR" } });
  advanceToExecute(run.id);
  assert.equal(advanceRun(run.id).run.status, "awaiting_approval"); // parado no git_pr
  // alguem anexa etapas destrutivas enquanto o run aguarda aprovacao
  const withPurchase = addStep(run.id, {
    title: "comprar",
    proposedEffect: { kind: "purchase", summary: "$$$" },
  });
  const purchaseId = withPurchase.steps[1].id;
  const withDelete = addStep(run.id, {
    title: "apagar",
    proposedEffect: { kind: "delete", summary: "rm -rf" },
  });
  const deleteId = withDelete.steps[2].id;

  assert.throws(() => approveStep(run.id, purchaseId), LoopStateError);
  assert.throws(() => approveStep(run.id, deleteId), LoopStateError);
  const after = getLoopRun(run.id)!;
  assert.equal(after.status, "awaiting_approval", "run continua parado");
  assert.equal(after.steps[1].status, "proposed", "purchase nao foi pre-aprovado");
  assert.equal(after.steps[2].status, "proposed", "delete nao foi pre-aprovado");
});

test("loopRunner (B-H3): approveStep fora de awaiting_approval ou em etapa nao-proposta e recusado", () => {
  ensureSchema();
  const run = startRun({ pattern: "approve-state" });
  const withStep = addStep(run.id, {
    title: "abrir PR",
    proposedEffect: { kind: "git_pr", summary: "PR" },
  });
  const stepId = withStep.steps[0].id;
  // run em report_only (ninguem pediu aprovacao ainda): aprovar e pre-aprovar -> recusa
  assert.throws(() => approveStep(run.id, stepId), LoopStateError);
  assert.equal(getLoopRun(run.id)!.steps[0].status, "proposed");

  advanceToExecute(run.id);
  assert.equal(advanceRun(run.id).run.status, "awaiting_approval");
  const freed = approveStep(run.id, stepId); // agora sim
  assert.equal(freed.steps[0].status, "approved");
  // etapa ja aprovada nao e "proposed": aprovar de novo e recusado
  assert.throws(() => approveStep(run.id, stepId), LoopStateError);
});
