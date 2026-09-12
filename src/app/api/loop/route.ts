/**
 * GET  /api/loop        — lista runs do Loop Engine (opcional ?status=...).
 * POST /api/loop        — inicia um run (report-only) { pattern, budget?, taskId?, correlationId? }.
 *
 * Autenticado (management) e gated pela flag LOOP_ENGINE_ENABLED. Report-only: iniciar um
 * run NÃO executa efeito externo. Serve ao painel único e a qualquer harness.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { listLoopRuns, startRun } from "@/lib/loopRunner";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
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

/** Tetos do orçamento (o motor aborta ao estourar; um teto absurdo desligaria o freio). */
const MAX_BUDGET_TOKENS = 10_000_000;
const MAX_BUDGET_WALL_CLOCK_MS = 7 * 24 * 60 * 60_000; // 7 dias
const MAX_BUDGET_ATTEMPTS = 100;

/**
 * `budget`: cada campo presente é um inteiro > 0 até o teto; nenhuma chave extra entra no
 * JSON persistido; campos omitidos usam os defaults do motor. `pattern` é um identificador
 * curto (vira tag no Buzz e chave de correlação); ids opacos ficam limitados a 64 chars.
 */
const startRunSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, "pattern must match [A-Za-z0-9._-]"),
  budget: z
    .strictObject({
      maxTokens: z.number().int().positive().max(MAX_BUDGET_TOKENS).optional(),
      maxWallClockMs: z.number().int().positive().max(MAX_BUDGET_WALL_CLOCK_MS).optional(),
      maxAttempts: z.number().int().positive().max(MAX_BUDGET_ATTEMPTS).optional(),
    })
    .optional(),
  taskId: z.string().min(1).max(64).optional(),
  correlationId: z.string().min(1).max(64).optional(),
});

function disabled(): Response {
  return createErrorResponse({
    status: 404,
    message: "Loop Engine is disabled. Enable LOOP_ENGINE_ENABLED in the OmniRoute panel.",
  });
}

export async function GET(req: Request): Promise<Response> {
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

export async function POST(req: Request): Promise<Response> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  if (!isFeatureFlagEnabled("LOOP_ENGINE_ENABLED")) return disabled();

  const validation = validateBody(startRunSchema, await req.json().catch(() => ({})));
  if (isValidationFailure(validation)) {
    return createErrorResponse({
      status: 400,
      message:
        "body must be { pattern: [A-Za-z0-9._-]{1,128}, budget?: { maxTokens?, maxWallClockMs?, maxAttempts? } (positive integers within limits, no other keys), taskId?: string(1-64), correlationId?: string(1-64) }",
      details: validation.error.details,
    });
  }
  const run = startRun(validation.data);
  return NextResponse.json({ run }, { status: 201 });
}
