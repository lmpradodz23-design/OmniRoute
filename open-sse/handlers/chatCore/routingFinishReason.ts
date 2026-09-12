/**
 * Best-effort finish_reason extraction from a (possibly translated) response body for
 * routing-event telemetry (handleChatCore → emitRoutingEvent). Understands the OpenAI
 * chat shape (`choices[0].finish_reason`) and the Responses shape (`output[].finish_reason`).
 * Returns null when the shape is unknown.
 */
export function routingFinishReason(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const fromChoices = finishReasonOf(Array.isArray(record.choices) ? record.choices[0] : null);
  if (fromChoices !== null) return fromChoices;
  if (!Array.isArray(record.output)) return null;
  for (const item of record.output) {
    const reason = finishReasonOf(item);
    if (reason !== null) return reason;
  }
  return null;
}

/** `finish_reason` of one choice/output item when it is a string, else null. */
function finishReasonOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const reason = (item as Record<string, unknown>).finish_reason;
  return typeof reason === "string" ? reason : null;
}
