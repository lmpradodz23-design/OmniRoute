import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySpanExporter,
  endSpan,
  formatTraceparent,
  parseTraceparent,
  safeAttributes,
  startSpan,
} from "@omniroute/open-sse/otel/index.ts";

test("otel: traceparent round-trip (formata e faz parse)", () => {
  const span = startSpan("req");
  const tp = formatTraceparent(span);
  const parsed = parseTraceparent(tp);
  assert.ok(parsed);
  assert.equal(parsed!.traceId, span.traceId);
  assert.equal(parsed!.spanId, span.spanId);
  assert.equal(parsed!.sampled, true);
});

test("otel: traceparent malformado / all-zero -> null (fail-closed)", () => {
  assert.equal(parseTraceparent("garbage"), null);
  assert.equal(parseTraceparent("00-" + "0".repeat(32) + "-" + "0".repeat(16) + "-01"), null);
});

test("otel: safeAttributes descarta chaves NÃO allowlisted (anti-vazamento)", () => {
  const a = safeAttributes({
    model: "gpt",
    provider: "openai",
    prompt: "segredo do usuário", // NÃO allowlisted → descartado
    api_key: "sk-abc", // NÃO allowlisted → descartado
    latency_ms: 12,
  });
  assert.deepEqual(a, { model: "gpt", provider: "openai", latency_ms: 12 });
  assert.equal("prompt" in a, false);
  assert.equal("api_key" in a, false);
});

test("otel: string allowlisted é truncada (nunca carrega blobs)", () => {
  const a = safeAttributes({ route: "x".repeat(200) });
  assert.equal((a.route as string).length, 64);
});

test("otel: span filho herda traceId e referencia o parent; export coleta", () => {
  const exp = new InMemorySpanExporter();
  const parent = startSpan("parent", undefined, { provider: "openai" }, 1000);
  const child = startSpan("child", parent, { model: "gpt" }, 1005);
  assert.equal(child.traceId, parent.traceId);
  assert.equal(child.parentSpanId, parent.spanId);
  endSpan(child, exp, { status: "ok", now: 1010 });
  endSpan(parent, exp, { status: "ok", now: 1020 });
  assert.equal(exp.spans.length, 2);
  assert.equal(exp.spans[0].endMs! - exp.spans[0].startMs, 5); // child durou 5ms
  assert.equal(exp.spans[1].status, "ok");
});

// ---- Regressao da auditoria adversarial (2026-09-12) ------------------------
// O NOME do span nao passava pela allowlist nem por truncamento: so `attributes` eram
// governados, entao um nome de 1.000.000 de caracteres era retido inteiro no ring buffer.
test("otel: nome do span e truncado e sem caracteres de controle", () => {
  const exporter = new InMemorySpanExporter();
  const span = startSpan("x".repeat(1_000_000) + "\n fim", undefined, {});
  endSpan(span, exporter, { status: "ok" });
  assert.ok(exporter.spans[0].name.length <= 120, "nome deve respeitar o teto");
  assert.doesNotMatch(exporter.spans[0].name, /[\u0000-\u001f]/, "sem caracteres de controle");
});
