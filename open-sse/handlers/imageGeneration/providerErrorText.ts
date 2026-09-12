/**
 * Provider error text helpers for image generation: parse/sanitize the upstream error body
 * and produce the text stored in the call log.
 *
 * Extracted from imageGeneration.ts (file-size ratchet). Leaf module: only the shared sanitizer.
 */
import { sanitizeErrorMessage, sanitizeUpstreamDetails } from "../../utils/error.ts";

export function parseJsonOrNull(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function sanitizeImageProviderError(errorText: string): unknown {
  const parsed = parseJsonOrNull(errorText);
  if (parsed !== null) {
    return sanitizeUpstreamDetails(parsed) || sanitizeErrorMessage(errorText);
  }
  return sanitizeErrorMessage(errorText);
}

/**
 * Call-log `error` text for a failed image request. `error` is a plain string
 * for handler-built messages, but provider HTTP failures carry the object
 * returned by sanitizeUpstreamDetails(), which is prototype-less (no toString),
 * so `String(error)` throws "Cannot convert object to primitive value".
 */
export function toStoredImageErrorText(error: unknown): string {
  let text: string;
  if (typeof error === "string") {
    text = error;
  } else if (error instanceof Error) {
    text = error.message || error.name;
  } else if (error && typeof error === "object") {
    try {
      text = JSON.stringify(error) ?? "[unserializable error]";
    } catch {
      text = "[unserializable error]";
    }
  } else {
    text = String(error);
  }
  return text.slice(0, 500);
}
