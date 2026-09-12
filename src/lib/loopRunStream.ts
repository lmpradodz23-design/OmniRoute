/**
 * Loop Run SSE — transmite um run do Loop como eventos AG-UI em Server-Sent Events, de verdade:
 * o corpo é um `ReadableStream` que enfileira frames conforme são produzidos.
 *
 * Fluxo de uma conexão:
 * 1. `retry:` (backoff do EventSource), RUN_STARTED e o snapshot atual (mensagens por etapa +
 *    STATE_SNAPSHOT);
 * 2. enquanto o run NÃO está em status terminal, faz polling de `getLoopRun` a cada `pollMs` e só
 *    emite algo quando `sequenceNumber` mudou (STATE_DELTA + mensagens das etapas novas/alteradas);
 *    um comentário `: ping` a cada `heartbeatMs` evita que proxies cortem a conexão ociosa;
 * 3. status terminal → RUN_FINISHED (done/escalated) ou RUN_ERROR (failed/aborted) e fecha;
 * 4. teto `maxLifetimeMs`: emite RUN_ERROR e fecha, para um run parado não prender a conexão.
 * Abort do request e `cancel()` do stream param tudo e limpam os timers.
 *
 * `seq` é determinístico por versão do run, para `Last-Event-ID` retomar sem replay: cada versão
 * `v` tem um bloco de seqs a partir de `(v + 1) * BLOCK` — metade inferior para o snapshot,
 * metade superior para o delta, último slot para o terminal. `id:` só vai no ÚLTIMO frame de cada
 * bloco, então o Last-Event-ID do cliente sempre aponta para um estado completo; na reconexão, todo
 * evento com `seq <= Last-Event-ID` é descartado. Report-only: só lê o run, nunca executa nada.
 */
import { encodeSse, type AgUiEvent } from "@omniroute/open-sse/ag-ui/index.ts";
import type { LoopRun, LoopRunStatus } from "@omniroute/open-sse/loop-engine/index.ts";

import { getLoopRun } from "./loopRunner";

interface SseTiming {
  readonly pollMs: number;
  readonly heartbeatMs: number;
  readonly maxLifetimeMs: number;
  readonly retryMs: number;
}

const DEFAULT_TIMING: SseTiming = {
  pollMs: 1_000,
  heartbeatMs: 15_000,
  maxLifetimeMs: 10 * 60_000,
  retryMs: 5_000,
};

/**
 * Status em que o motor encerra a transição (stateMachine.ts): done (tudo verificado), failed
 * (efeito negado), escalated (handoff humano), aborted (budget). Os demais seguem vivos.
 */
const TERMINAL_STATUSES: ReadonlySet<LoopRunStatus> = new Set([
  "done",
  "failed",
  "escalated",
  "aborted",
]);
const ERROR_STATUSES: ReadonlySet<LoopRunStatus> = new Set(["failed", "aborted"]);

const BLOCK = 2 ** 20;
const HALF_BLOCK = BLOCK / 2;
/** 3 eventos por etapa + 1 de estado cabem na metade do bloco sem tocar o slot terminal. */
const MAX_RENDERED_STEPS = Math.floor((HALF_BLOCK - 2) / 3);

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

type LoopStep = LoopRun["steps"][number];

function blockBase(version: number): number {
  return (version + 1) * BLOCK;
}

function runState(run: LoopRun): Record<string, unknown> {
  return { phase: run.phase, status: run.status, sequenceNumber: run.sequenceNumber };
}

function stepMessage(run: LoopRun, step: LoopStep, messageId: string, seq: number): AgUiEvent[] {
  const effect =
    step.proposedEffect && step.proposedEffect.kind !== "none"
      ? ` [efeito proposto: ${step.proposedEffect.kind}]`
      : "";
  return [
    { seq, runId: run.id, type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    {
      seq: seq + 1,
      runId: run.id,
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: `${step.index + 1}. ${step.title} (${step.status})${effect}`,
    },
    { seq: seq + 2, runId: run.id, type: "TEXT_MESSAGE_END", messageId },
  ];
}

function renderSnapshot(run: LoopRun): AgUiEvent[] {
  let seq = blockBase(run.sequenceNumber);
  const events: AgUiEvent[] = [];
  for (const step of run.steps.slice(0, MAX_RENDERED_STEPS)) {
    events.push(...stepMessage(run, step, `step-${step.index}`, seq));
    seq += 3;
  }
  events.push({ seq, runId: run.id, type: "STATE_SNAPSHOT", state: runState(run) });
  return events;
}

function renderDelta(previous: LoopRun, run: LoopRun): AgUiEvent[] {
  const seen = new Map(previous.steps.map((s) => [s.id, s.status]));
  const changed = run.steps.filter((s) => seen.get(s.id) !== s.status);
  const before = runState(previous);
  const patch = Object.fromEntries(
    Object.entries(runState(run)).filter(([k, v]) => before[k] !== v)
  );

  let seq = blockBase(run.sequenceNumber) + HALF_BLOCK;
  const events: AgUiEvent[] = [];
  for (const step of changed.slice(0, MAX_RENDERED_STEPS)) {
    events.push(...stepMessage(run, step, `step-${step.index}@${run.sequenceNumber}`, seq));
    seq += 3;
  }
  events.push({ seq, runId: run.id, type: "STATE_DELTA", patch });
  return events;
}

function terminalEvent(run: LoopRun): AgUiEvent {
  const seq = blockBase(run.sequenceNumber) + BLOCK - 1;
  if (ERROR_STATUSES.has(run.status)) {
    return { seq, runId: run.id, type: "RUN_ERROR", message: `loop run ${run.status}` };
  }
  return { seq, runId: run.id, type: "RUN_FINISHED" };
}

/** `Last-Event-ID` válido (inteiro não negativo) ou -1 (conexão nova). */
function parseLastEventId(headers: Headers): number {
  const raw = headers.get("last-event-id")?.trim() ?? "";
  return /^\d{1,15}$/.test(raw) ? Number(raw) : -1;
}

class LoopRunSseSession {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly encoder = new TextEncoder();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSeq = 0;
  private closed = false;
  private last: LoopRun;
  private readonly resumeAfter: number;
  private readonly timing: SseTiming;
  private readonly signal: AbortSignal;
  private readonly onAbort = (): void => this.stop();

  constructor(run: LoopRun, resumeAfter: number, timing: SseTiming, signal: AbortSignal) {
    this.last = run;
    this.resumeAfter = resumeAfter;
    this.timing = timing;
    this.signal = signal;
  }

  start(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = controller;
    if (this.signal.aborted) {
      this.stop();
      return;
    }
    this.signal.addEventListener("abort", this.onAbort, { once: true });
    this.write(`retry: ${this.timing.retryMs}\n\n`);
    this.emit([{ seq: 0, runId: this.last.id, type: "RUN_STARTED" }]);
    this.emit(renderSnapshot(this.last));
    if (this.finishIfTerminal(this.last)) return;
    this.pollTimer = setInterval(() => this.poll(), this.timing.pollMs);
    this.heartbeatTimer = setInterval(() => this.write(": ping\n\n"), this.timing.heartbeatMs);
    this.lifetimeTimer = setTimeout(
      () => this.fail("stream max lifetime reached; reconnect with Last-Event-ID to resume"),
      this.timing.maxLifetimeMs
    );
  }

  /** Idempotente: limpa timers, solta o listener de abort e fecha o stream (se ainda aberto). */
  stop(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pollTimer);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.lifetimeTimer);
    this.signal.removeEventListener("abort", this.onAbort);
    try {
      this.controller?.close();
    } catch {
      // stream já cancelado pelo cliente: nada a fechar
    }
  }

  private poll(): void {
    if (this.closed) return;
    let run: LoopRun | null;
    try {
      run = getLoopRun(this.last.id) ?? null;
    } catch {
      this.fail("failed to read loop run");
      return;
    }
    if (!run) {
      this.fail("loop run not found");
      return;
    }
    if (run.sequenceNumber <= this.last.sequenceNumber) return;
    this.emit(renderDelta(this.last, run));
    this.last = run;
    this.finishIfTerminal(run);
  }

  private finishIfTerminal(run: LoopRun): boolean {
    if (!TERMINAL_STATUSES.has(run.status)) return false;
    this.emit([terminalEvent(run)]);
    this.stop();
    return true;
  }

  /** Terminal da CONEXÃO (não do run): sem `id:`, para a reconexão retomar do último estado. */
  private fail(message: string): void {
    const seq = Math.max(this.lastSeq, this.resumeAfter) + 1;
    this.emit([{ seq, runId: this.last.id, type: "RUN_ERROR", message }], false);
    this.stop();
  }

  /** Emite um bloco: descarta seq já vistos (Last-Event-ID) e põe `id:` só no último frame. */
  private emit(block: AgUiEvent[], withId = true): void {
    if (block.length === 0) return;
    this.lastSeq = Math.max(this.lastSeq, block[block.length - 1].seq);
    const fresh = block.filter((e) => e.seq > this.resumeAfter);
    const lastIndex = fresh.length - 1;
    const body = fresh
      .map((e, i) => (withId && i === lastIndex ? `id: ${e.seq}\n` : "") + encodeSse(e))
      .join("");
    if (body) this.write(body);
  }

  private write(chunk: string): void {
    if (this.closed || !this.controller) return;
    try {
      this.controller.enqueue(this.encoder.encode(chunk));
    } catch {
      this.stop();
    }
  }
}

/**
 * Resposta SSE de um run (auth/flag/404 ficam na rota, ANTES daqui). `timing` só sobrescreve os
 * intervalos padrão. Se o cliente já recebeu o terminal desta versão, responde 204 — pela spec do
 * EventSource isso encerra as reconexões.
 */
export function loopRunSseResponse(
  run: LoopRun,
  request: Pick<Request, "signal" | "headers">,
  timing?: Partial<SseTiming>
): Response {
  const resumeAfter = parseLastEventId(request.headers);
  if (TERMINAL_STATUSES.has(run.status) && resumeAfter >= terminalEvent(run).seq) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-cache" } });
  }
  const session = new LoopRunSseSession(
    run,
    resumeAfter,
    { ...DEFAULT_TIMING, ...timing },
    request.signal
  );
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => session.start(controller),
    cancel: () => session.stop(),
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
