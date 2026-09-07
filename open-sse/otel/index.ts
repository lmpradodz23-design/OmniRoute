/**
 * OTel-lite — tracing distribuído leve (Fase 8), SEM dependência pesada e SEM conteúdo sensível.
 *
 * Implementa W3C Trace Context (traceparent) e spans com atributos ALLOWLISTED: nenhum prompt,
 * resposta, PII ou segredo entra num span — só metadados operacionais (provider, model, rota,
 * latência, tokens, status). Exportador plugável (InMemory p/ teste; OTLP fica na camada externa).
 * Puro, determinístico onde possível; ids aleatórios via crypto.
 */
import { randomBytes } from "node:crypto";

export interface SpanContext {
  readonly traceId: string; // 32 hex
  readonly spanId: string; // 16 hex
  readonly parentSpanId?: string;
}

export type SpanStatus = "unset" | "ok" | "error";

export interface Span extends SpanContext {
  name: string;
  startMs: number;
  endMs?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

export interface SpanExporter {
  export(span: Span): void;
}

export class InMemorySpanExporter implements SpanExporter {
  readonly spans: Span[] = [];
  export(span: Span): void {
    this.spans.push(span);
  }
}

/** Chaves de atributo PERMITIDAS num span. Qualquer outra é descartada (anti-vazamento). */
export const SAFE_ATTR_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "model",
  "route",
  "http.method",
  "http.status_code",
  "latency_ms",
  "tokens_in",
  "tokens_out",
  "tenant",
  "cache",
  "error.kind",
]);

const MAX_ATTR_STR = 64;

/**
 * Mantém APENAS chaves allowlisted e valores primitivos; strings são truncadas. Isso garante que
 * conteúdo sensível (prompts/respostas/segredos) nunca chegue à telemetria, mesmo por engano.
 */
export function safeAttributes(
  attrs: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!SAFE_ATTR_KEYS.has(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, MAX_ATTR_STR);
  }
  return out;
}

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

export function genTraceId(): string {
  return hex(16);
}
export function genSpanId(): string {
  return hex(8);
}

/** Formata um traceparent W3C: 00-<traceId>-<spanId>-<flags>. */
export function formatTraceparent(ctx: SpanContext, sampled = true): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${sampled ? "01" : "00"}`;
}

/** Faz parse de um traceparent W3C. Retorna null se malformado (fail-closed). */
export function parseTraceparent(
  header: string
): { traceId: string; spanId: string; sampled: boolean } | null {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(header.trim());
  if (!m) return null;
  if (/^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null; // all-zero é inválido
  return {
    traceId: m[1].toLowerCase(),
    spanId: m[2].toLowerCase(),
    sampled: (parseInt(m[3], 16) & 1) === 1,
  };
}

/** Cria um novo span. Se `parent` for dado, herda o traceId e referencia o parentSpanId. */
export function startSpan(
  name: string,
  parent?: SpanContext,
  attrs: Record<string, unknown> = {},
  now: number = Date.now()
): Span {
  return {
    traceId: parent?.traceId ?? genTraceId(),
    spanId: genSpanId(),
    parentSpanId: parent?.spanId,
    name,
    startMs: now,
    status: "unset",
    attributes: safeAttributes(attrs),
  };
}

/** Encerra o span e o exporta. Mescla atributos finais (sempre pela allowlist). */
export function endSpan(
  span: Span,
  exporter: SpanExporter,
  opts: { status?: SpanStatus; attributes?: Record<string, unknown>; now?: number } = {}
): Span {
  span.endMs = opts.now ?? Date.now();
  if (opts.status) span.status = opts.status;
  if (opts.attributes) Object.assign(span.attributes, safeAttributes(opts.attributes));
  exporter.export(span);
  return span;
}
