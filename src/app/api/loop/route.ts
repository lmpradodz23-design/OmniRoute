/**
 * GET  /api/loop        — lista runs do Loop Engine (opcional ?status=...).
 * POST /api/loop        — inicia um run (report-only) { pattern, budget?, taskId? }.
 *
 * Autenticado (management) e gated pela flag LOOP_ENGINE_ENABLED. Report-only: iniciar um
 * run NÃO executa efeito externo. Serve ao painel único e a qualquer harness.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { listLoopRuns, startRun } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import type { LoopRun } from "@omniroute/open-sse/loop-engine/index.ts";

const LOOP_STATUSES: ReadonlyArray<LoopRun["status"]> = [
  "report_only",
  "awaiting_approval",
  "verifying",
  "done",
  "failed",
  "escalated",
  "aborted",
];

function disabled(): NextResponse {
  return NextResponse.json(
    { error: "Loop Engine is disabled. Enable LOOP_ENGINE_ENABLED in the OmniRoute panel." },
    { status: 404 }
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) return disabled();

  const raw = new URL(req.url).searchParams.get("status");
  const status =
    raw && LOOP_STATUSES.includes(raw as LoopRun["status"])
      ? (raw as LoopRun["status"])
      : undefined;
  return NextResponse.json({ runs: listLoopRuns(status) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) return disabled();

  const body = (await req.json().catch(() => ({}))) as {
    pattern?: unknown;
    budget?: Record<string, number>;
    taskId?: unknown;
    correlationId?: unknown;
  };
  const pattern = typeof body.pattern === "string" ? body.pattern.trim() : "";
  if (!pattern) {
    return NextResponse.json({ error: "pattern is required" }, { status: 400 });
  }
  const run = startRun({
    pattern,
    budget: body.budget,
    taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    correlationId: typeof body.correlationId === "string" ? body.correlationId : undefined,
  });
  return NextResponse.json({ run }, { status: 201 });
}
