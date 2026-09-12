/**
 * GET /api/loop/[id]/stream — transmite o estado de um run do Loop como eventos AG-UI (SSE).
 *
 * Autenticado (management) e gated por LOOP_ENGINE_ENABLED. Emite RUN_STARTED, um bloco de texto
 * por etapa (START/CONTENT/END), um STATE_SNAPSHOT (fase/status) e RUN_FINISHED — fluxo AG-UI válido
 * (ordenado por seq), consumível por um EventSource no Agent Console. Report-only (só leitura).
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getLoopRun } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { createSeq, encodeSse, type AgUiEvent } from "@omniroute/open-sse/ag-ui/index.ts";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) {
    return NextResponse.json({ error: "Loop Engine is disabled." }, { status: 404 });
  }
  const { id } = await params;
  const run = getLoopRun(id);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const seq = createSeq();
  const events: AgUiEvent[] = [{ seq: seq(), runId: run.id, type: "RUN_STARTED" }];
  for (const step of run.steps) {
    const messageId = `step-${step.index}`;
    events.push({
      seq: seq(),
      runId: run.id,
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant",
    });
    const effect =
      step.proposedEffect && step.proposedEffect.kind !== "none"
        ? ` [efeito proposto: ${step.proposedEffect.kind}]`
        : "";
    events.push({
      seq: seq(),
      runId: run.id,
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: `${step.index + 1}. ${step.title} (${step.status})${effect}`,
    });
    events.push({ seq: seq(), runId: run.id, type: "TEXT_MESSAGE_END", messageId });
  }
  events.push({
    seq: seq(),
    runId: run.id,
    type: "STATE_SNAPSHOT",
    state: { phase: run.phase, status: run.status, sequenceNumber: run.sequenceNumber },
  });
  events.push({ seq: seq(), runId: run.id, type: "RUN_FINISHED" });

  const body = events.map(encodeSse).join("");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
