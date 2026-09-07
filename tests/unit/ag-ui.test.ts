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
