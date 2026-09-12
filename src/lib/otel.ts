/**
 * OTel server singleton — exportador em memória (ring buffer) + helper de trace por requisição.
 *
 * Torna o core `open-sse/otel` USÁVEL no runtime: um exportador único guarda os últimos spans
 * (sem conteúdo sensível — a allowlist do core garante) para inspeção via GET /api/otel/spans.
 * Só coleta quando OTEL_TRACING_ENABLED está ON. Nada bloqueia a requisição.
 */
import {
  InMemorySpanExporter,
  endSpan,
  startSpan,
  type Span,
} from "@omniroute/open-sse/otel/index.ts";

import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

const MAX_SPANS = 500;

class RingExporter extends InMemorySpanExporter {
  export(span: Span): void {
    super.export(span);
    if (this.spans.length > MAX_SPANS) this.spans.splice(0, this.spans.length - MAX_SPANS);
  }
}

// Singleton por processo.
const g = globalThis as unknown as { __omniOtel?: RingExporter };
export const otelExporter: RingExporter = (g.__omniOtel ??= new RingExporter());

/** Spans recentes (mais novos por último). Cópia rasa para leitura segura. */
export function recentSpans(limit = 100): Span[] {
  return otelExporter.spans.slice(-limit);
}

/**
 * Envolve uma operação síncrona num span (só quando a flag está ON). Atributos passam pela
 * allowlist do core (nada sensível). Retorna o resultado da operação intacto.
 */
export function traceSync<T>(name: string, attributes: Record<string, unknown>, fn: () => T): T {
  if (!isFeatureFlagEnabled("OTEL_TRACING_ENABLED")) return fn();
  const span = startSpan(name, undefined, attributes);
  try {
    const out = fn();
    endSpan(span, otelExporter, { status: "ok" });
    return out;
  } catch (e) {
    endSpan(span, otelExporter, { status: "error", attributes: { "error.kind": "exception" } });
    throw e;
  }
}
