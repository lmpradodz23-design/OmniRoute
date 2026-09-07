import assert from "node:assert/strict";
import test from "node:test";

import {
  advance,
  checkBudget,
  createLoopRun,
  decideEffect,
  proposeStep,
  type LoopBudget,
  type LoopBudgetUsage,
} from "@omniroute/open-sse/loop-engine/index.ts";

const BUDGET: LoopBudget = { maxTokens: 1000, maxWallClockMs: 60_000, maxAttempts: 2 };

test("budget: dentro e estourado", () => {
  const usage: LoopBudgetUsage = { tokens: 500, wallClockMs: 1000, attempts: 1 };
  assert.equal(checkBudget(BUDGET, usage).ok, true);
  const over = checkBudget(BUDGET, { tokens: 1001, wallClockMs: 1, attempts: 0 });
  assert.equal(over.ok, false);
  assert.deepEqual(over.exceeded, ["tokens"]);
});

test("policyGate: none permite, destrutivo nega, report-only exige aprovacao", () => {
  assert.equal(decideEffect({ kind: "none", summary: "" }, { reportOnly: false }).outcome, "allow");
  assert.equal(
    decideEffect({ kind: "delete", summary: "rm" }, { reportOnly: false }).outcome,
    "deny"
  );
  assert.equal(
    decideEffect({ kind: "git_commit", summary: "c" }, { reportOnly: true }).outcome,
    "require_approval"
  );
});

test("policyGate: kind sensivel so auto-executa se o operador liberou (e nunca destrutivo)", () => {
  const eff = { kind: "message_send", summary: "oi" } as const;
  assert.equal(decideEffect(eff, { reportOnly: false }).outcome, "require_approval");
  assert.equal(
    decideEffect(eff, { reportOnly: false, autoApproveKinds: ["message_send"] }).outcome,
    "allow"
  );
  // destrutivo permanece negado mesmo se listado
  assert.equal(
    decideEffect(
      { kind: "purchase", summary: "$" },
      {
        reportOnly: false,
        autoApproveKinds: ["purchase"],
      }
    ).outcome,
    "deny"
  );
});

test("stateMachine: report-only para efeito -> awaiting_approval", () => {
  const run = createLoopRun({ pattern: "daily-triage", budget: BUDGET });
  run.phase = "execute";
  proposeStep(run, { title: "abrir PR", proposedEffect: { kind: "git_pr", summary: "PR #1" } });
  const { run: after, note } = advance(run, { policy: { reportOnly: true } });
  assert.equal(after.status, "awaiting_approval");
  assert.match(note, /aprova/i);
});

test("stateMachine: budget estourado -> aborted", () => {
  const run = createLoopRun({ pattern: "x", budget: BUDGET });
  const { run: after } = advance(run, {
    consumed: { tokens: 5000 },
    policy: { reportOnly: true },
  });
  assert.equal(after.status, "aborted");
});

test("stateMachine: verifier reprova sem tentativas -> escalated (handoff humano)", () => {
  const run = createLoopRun({ pattern: "x", budget: { ...BUDGET, maxAttempts: 1 } });
  run.phase = "verify";
  run.usage.attempts = 1; // ja gastou a unica tentativa
  const step = proposeStep(run, { title: "t" });
  const { run: after } = advance(run, {
    verdict: { stepId: step.id, approved: false, reason: "falhou" },
    policy: { reportOnly: true },
  });
  assert.equal(after.status, "escalated");
});

test("stateMachine: teto de tentativas e AUTO-IMPOSTO pelo motor (chamador nao passa attempts)", () => {
  // maxAttempts=2. O chamador NUNCA informa consumed.attempts; mesmo assim o motor deve
  // repetir a 1a reprova e ESCALAR na 2a (invariante do teto, sem depender do chamador).
  const run = createLoopRun({ pattern: "x", budget: { ...BUDGET, maxAttempts: 2 } });
  run.phase = "verify";
  const step = proposeStep(run, { title: "t" });

  const r1 = advance(run, {
    verdict: { stepId: step.id, approved: false, reason: "falhou 1" },
    policy: { reportOnly: true },
  });
  assert.equal(r1.run.status, "report_only"); // 1a reprova -> repete
  assert.equal(r1.run.usage.attempts, 1); // motor contou a tentativa

  // 2a reprova, de novo sem consumed.attempts, na fase verify.
  r1.run.phase = "verify";
  const r2 = advance(r1.run, {
    verdict: { stepId: step.id, approved: false, reason: "falhou 2" },
    policy: { reportOnly: true },
  });
  assert.equal(r2.run.usage.attempts, 2);
  assert.equal(r2.run.status, "escalated"); // teto atingido -> handoff humano
});

test("stateMachine: todos verificados na fase verify -> done", () => {
  const run = createLoopRun({ pattern: "x", budget: BUDGET });
  run.phase = "verify";
  const step = proposeStep(run, { title: "t" });
  step.status = "verified";
  const { run: after } = advance(run, { policy: { reportOnly: true } });
  assert.equal(after.status, "done");
});

test("createLoopRun: comeca report-only, discover, sequence 0", () => {
  const run = createLoopRun({ pattern: "p" });
  assert.equal(run.status, "report_only");
  assert.equal(run.phase, "discover");
  assert.equal(run.sequenceNumber, 0);
  assert.ok(run.correlationId.length > 0);
});
