/**
 * AG-UI — contrato de eventos agente→UI (Fase 7, Agent Console). Tipos + encoder SSE +
 * validação de sequência. Puro (sem I/O). Permite replay/reconexão determinísticos: a UI
 * reconstrói o estado a partir do fluxo de eventos ordenado.
 *
 * Segue o espírito do protocolo AG-UI (ciclo de run, deltas de texto, tool calls, estado).
 */

export type AgUiEventType =
  | "RUN_STARTED"
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "RUN_FINISHED"
  | "RUN_ERROR";

interface Base {
  readonly seq: number; // ordem monotônica (para replay/reconexão)
  readonly runId: string;
}

export type AgUiEvent =
  | (Base & { type: "RUN_STARTED" })
  | (Base & { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" | "tool" })
  | (Base & { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string })
  | (Base & { type: "TEXT_MESSAGE_END"; messageId: string })
  | (Base & { type: "TOOL_CALL_START"; toolCallId: string; name: string })
  | (Base & { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string })
  | (Base & { type: "TOOL_CALL_END"; toolCallId: string })
  | (Base & { type: "STATE_SNAPSHOT"; state: Record<string, unknown> })
  | (Base & { type: "STATE_DELTA"; patch: Record<string, unknown> })
  | (Base & { type: "RUN_FINISHED" })
  | (Base & { type: "RUN_ERROR"; message: string });

export const TERMINAL_EVENTS: ReadonlySet<AgUiEventType> = new Set(["RUN_FINISHED", "RUN_ERROR"]);

/** Codifica um evento como frame SSE (event: <type>\ndata: <json>\n\n). */
export function encodeSse(event: AgUiEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface SequenceValidation {
  readonly ok: boolean;
  readonly errors: string[];
}

/**
 * Valida invariantes do fluxo (para catch de bugs de emissão, não de segurança):
 * - `seq` estritamente crescente;
 * - primeiro evento = RUN_STARTED e RUN_STARTED aparece SÓ no índice 0 (nunca reinicia no meio);
 * - todos os eventos do MESMO runId (fluxo de um run só);
 * - exatamente um terminal (RUN_FINISHED|RUN_ERROR), e ele é o último;
 * - nenhum evento após o terminal.
 */
export function validateEventSequence(events: ReadonlyArray<AgUiEvent>): SequenceValidation {
  const errors: string[] = [];
  if (events.length === 0) return { ok: false, errors: ["fluxo vazio"] };

  if (events[0].type !== "RUN_STARTED") errors.push("primeiro evento deve ser RUN_STARTED");
  const runId = events[0].runId;

  let lastSeq = -Infinity;
  let terminalAt = -1;
  events.forEach((e, i) => {
    // `NaN <= x` e sempre falso, entao um seq NaN passava e ainda zerava a comparacao seguinte:
    // o fluxo 0,5,NaN,2,3 era aceito apesar da regressao 5 -> 2. Exigir um numero finito.
    if (!Number.isFinite(e.seq)) errors.push(`seq nao numerico em ${i} (${String(e.seq)})`);
    else if (e.seq <= lastSeq) errors.push(`seq nao crescente em ${i} (${e.seq})`);
    if (Number.isFinite(e.seq)) lastSeq = e.seq;
    if (e.type === "RUN_STARTED" && i !== 0) errors.push(`RUN_STARTED duplicado no índice ${i}`);
    if (e.runId !== runId) errors.push(`runId inconsistente no índice ${i} (${e.runId})`);
    if (TERMINAL_EVENTS.has(e.type)) {
      if (terminalAt !== -1) errors.push(`múltiplos eventos terminais (índice ${i})`);
      terminalAt = i;
    }
  });

  if (terminalAt === -1) errors.push("faltou evento terminal (RUN_FINISHED|RUN_ERROR)");
  else if (terminalAt !== events.length - 1) errors.push("há eventos após o terminal");

  return { ok: errors.length === 0, errors };
}

/** Fábrica incremental de seq — ajuda emissores a produzir fluxos válidos. */
export function createSeq(start = 0): () => number {
  let n = start;
  return () => n++;
}
