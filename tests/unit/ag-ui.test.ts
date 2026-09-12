import assert from "node:assert/strict";
import test from "node:test";

import {
  createSeq,
  encodeSse,
  validateEventSequence,
  type AgUiEvent,
} from "@omniroute/open-sse/ag-ui/index.ts";

function validRun(): AgUiEvent[] {
  const s = createSeq();
  const runId = "r1";
  return [
    { seq: s(), runId, type: "RUN_STARTED" },
    { seq: s(), runId, type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    { seq: s(), runId, type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "oi" },
    { seq: s(), runId, type: "TEXT_MESSAGE_END", messageId: "m1" },
    { seq: s(), runId, type: "RUN_FINISHED" },
  ];
}

test("ag-ui: fluxo válido passa na validação", () => {
  assert.equal(validateEventSequence(validRun()).ok, true);
});

test("ag-ui: encodeSse produz frame SSE (event + data JSON)", () => {
  const frame = encodeSse({ seq: 0, runId: "r1", type: "RUN_STARTED" });
  assert.match(frame, /^event: RUN_STARTED\ndata: \{.*\}\n\n$/s);
});

test("ag-ui: sem RUN_STARTED no início -> inválido", () => {
  const ev = validRun().slice(1);
  const v = validateEventSequence(ev);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /RUN_STARTED/.test(e)));
});

test("ag-ui: seq não crescente -> inválido", () => {
  const ev = validRun();
  (ev[2] as { seq: number }).seq = ev[1].seq; // duplica seq
  assert.equal(validateEventSequence(ev).ok, false);
});

test("ag-ui: evento após o terminal -> inválido", () => {
  const ev = validRun();
  ev.push({ seq: 99, runId: "r1", type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "x" });
  const v = validateEventSequence(ev);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /após o terminal/.test(e)));
});

test("ag-ui: faltou terminal -> inválido", () => {
  const ev = validRun().slice(0, 4); // sem RUN_FINISHED
  assert.equal(validateEventSequence(ev).ok, false);
});

test("ag-ui: RUN_STARTED duplicado no meio do fluxo -> inválido", () => {
  const ev = validRun();
  ev.splice(2, 0, { seq: 99, runId: "r1", type: "RUN_STARTED" }); // reinício espúrio no meio
  const v = validateEventSequence(ev);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /RUN_STARTED duplicado/.test(e)));
});

test("ag-ui: runId inconsistente entre eventos -> inválido", () => {
  const ev = validRun();
  (ev[2] as { runId: string }).runId = "OUTRO"; // evento de outro run misturado
  const v = validateEventSequence(ev);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /runId inconsistente/.test(e)));
});

// ---- Regressao da auditoria adversarial (2026-09-12) ------------------------
// `NaN <= x` e sempre falso, entao um seq NaN passava pela checagem de monotonicidade e
// ainda zerava a comparacao seguinte: 0,5,NaN,2,3 era aceito apesar da regressao 5 -> 2.
test("ag-ui: seq nao numerico e rejeitado e nao mascara a regressao seguinte", () => {
  const runId = "r1";
  const events: AgUiEvent[] = [
    { type: "RUN_STARTED", seq: 0, runId },
    { type: "TEXT_MESSAGE_CONTENT", seq: 5, runId, messageId: "m", delta: "a" },
    { type: "TEXT_MESSAGE_CONTENT", seq: Number.NaN, runId, messageId: "m", delta: "b" },
    { type: "TEXT_MESSAGE_CONTENT", seq: 2, runId, messageId: "m", delta: "c" },
    { type: "RUN_FINISHED", seq: 3, runId },
  ];
  const v = validateEventSequence(events);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.some((e) => /nao numerico/.test(e)),
    "o seq NaN precisa ser apontado"
  );
  assert.ok(
    v.errors.some((e) => /nao crescente/.test(e)),
    "a regressao 5 -> 2 nao pode ficar mascarada"
  );
});
