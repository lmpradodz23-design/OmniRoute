import {
  DEFAULT_CLIENT_FORMAT,
  extractSignatureContext,
  generateSignature,
  getCachedResponse,
  isCacheableForRead,
} from "@/lib/semanticCache";
import { calculateCost } from "@/lib/usage/costCalculator";
import { trackPendingRequest } from "@/lib/usageDb";
import { synthesizeOpenAiSseFromJson } from "../../utils/jsonToSse.ts";
import { attachOmniRouteMetaHeaders } from "@/domain/omnirouteResponseMeta";
import { extractUsageFromResponse } from "../usageExtractor.ts";
import { OMNIROUTE_RESPONSE_HEADERS } from "@/shared/constants/headers";

type CheckSemanticCacheArgs = {
  semanticCacheEnabled: boolean;
  // Only the fields this read path actually touches are named; everything else
  // on the request body stays `unknown` via the index signature.
  body: Record<string, unknown> & { temperature?: number; top_p?: number };
  clientRawRequest: { headers?: unknown } | null;
  model: string;
  provider: string;
  stream: boolean;
  reqLogger: { logConvertedResponse: (response: Record<string, unknown>) => void };
  effectiveServiceTier: string | null | undefined;
  connectionId: string | null;
  startTime: number;
  log: { debug?: (...args: unknown[]) => void } | null;
  persistAttemptLogs: (args: unknown) => void;
  apiKeyId?: string | null;
  cacheDefaultMode?: "legacy" | "bypass" | null;
  /** Client wire format — the cached body is only valid for the same format. */
  sourceFormat?: string;
};

type SemanticCacheHitContext = Pick<
  CheckSemanticCacheArgs,
  | "model"
  | "provider"
  | "stream"
  | "reqLogger"
  | "effectiveServiceTier"
  | "connectionId"
  | "startTime"
  | "log"
  | "persistAttemptLogs"
>;

/**
 * Serve a cache HIT: log it, account the would-have-been cost, persist the attempt and
 * build the client response (SSE re-synthesized for a streaming Chat Completions client).
 */
async function serveSemanticCacheHit(
  cached: NonNullable<ReturnType<typeof getCachedResponse>>,
  {
    model,
    provider,
    stream,
    reqLogger,
    effectiveServiceTier,
    connectionId,
    startTime,
    log,
    persistAttemptLogs,
  }: SemanticCacheHitContext
) {
  log?.debug?.("CACHE", `Semantic cache HIT for ${model} (stream=${stream})`);
  reqLogger.logConvertedResponse(cached as Record<string, unknown>);
  const cachedUsage =
    extractUsageFromResponse(cached as Record<string, unknown>, provider) ||
    ((cached as Record<string, unknown>)?.usage as Record<string, unknown> | undefined);
  const cachedCost = cachedUsage
    ? await calculateCost(provider, model, cachedUsage as Record<string, number>, {
        serviceTier: effectiveServiceTier,
      })
    : 0;
  persistAttemptLogs({
    status: 200,
    tokens: (cached as Record<string, unknown>)?.usage,
    responseBody: cached,
    providerRequest: null,
    providerResponse: null,
    clientResponse: cached,
    cacheSource: "semantic",
  });
  trackPendingRequest(model, provider, connectionId, false);
  const cachedSse = stream ? synthesizeOpenAiSseFromJson(JSON.stringify(cached)) : "";
  const headers: Record<string, string> = {
    "Content-Type": cachedSse ? "text/event-stream" : "application/json",
    [OMNIROUTE_RESPONSE_HEADERS.cache]: "HIT",
    // Marker for latency measurement tools: this response served from cache
    // has synthetic (near-zero) latency, not real upstream latency.
    [OMNIROUTE_RESPONSE_HEADERS.cacheLatency]: "synthetic",
  };
  // A cache HIT serves WITHOUT an upstream call, so the incremental cost billed to
  // the client is 0 (consumers that sum X-OmniRoute-Response-Cost must not charge for
  // hits). The original/would-have-been cost is surfaced via X-OmniRoute-Cost-Saved.
  attachOmniRouteMetaHeaders(headers, {
    provider,
    model,
    cacheHit: true,
    latencyMs: Date.now() - startTime,
    usage: cachedUsage,
    costUsd: 0,
    costSavedUsd: cachedCost,
  });
  return {
    success: true,
    response: new Response(cachedSse || JSON.stringify(cached), {
      headers,
    }),
  };
}

export async function checkSemanticCache(args: CheckSemanticCacheArgs) {
  const {
    semanticCacheEnabled,
    body,
    clientRawRequest,
    model,
    stream,
    apiKeyId,
    cacheDefaultMode,
    sourceFormat,
  } = args;
  // Per-key bypass: skip cache lookup entirely when the API key opts out.
  if (cacheDefaultMode === "bypass") return null;
  // A streamed HIT is re-emitted as SSE by synthesizeOpenAiSseFromJson(), which only knows
  // the Chat Completions shape. For a claude / openai-responses client asking for a stream
  // the cache would answer JSON to a client expecting SSE — treat it as a MISS instead
  // (the request goes upstream and streams normally).
  if (stream && (sourceFormat || DEFAULT_CLIENT_FORMAT) !== DEFAULT_CLIENT_FORMAT) return null;
  if (!semanticCacheEnabled || !isCacheableForRead(body, clientRawRequest?.headers)) return null;
  const signature = generateSignature(
    model,
    body.messages ?? body.input,
    body.temperature,
    body.top_p,
    apiKeyId ?? undefined,
    sourceFormat,
    extractSignatureContext(body)
  );
  const cached = getCachedResponse(signature);
  if (!cached) return null;
  return serveSemanticCacheHit(cached, args);
}
