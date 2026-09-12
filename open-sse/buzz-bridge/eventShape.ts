/**
 * Buzz Bridge — inbound event shape limits (audit B-M3).
 *
 * The relay is a separate, network-reachable service: everything it sends is untrusted input.
 * Frames are capped at the socket (`maxPayload`), and each EVENT is shape-checked here BEFORE any
 * signature work or persistence, so a hostile relay cannot make the bridge hash megabytes of
 * content, allocate unbounded tag arrays, or store junk in `buzz_inbox`. Pure and bounded.
 */
import type { SignedNostrEvent } from "./nostr.ts";

/** Largest WebSocket frame accepted from the relay (ws `maxPayload`). */
export const MAX_RELAY_FRAME_BYTES = 1 << 20;
/** Largest `content` (UTF-8 bytes) accepted in an inbound event. */
export const MAX_EVENT_CONTENT_BYTES = 64 * 1024;
/** Upper bounds on the `tags` matrix. */
export const MAX_EVENT_TAGS = 64;
export const MAX_TAG_ITEMS = 16;
export const MAX_TAG_ITEM_CHARS = 1024;

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

function isHex(value: unknown, pattern: RegExp): boolean {
  return typeof value === "string" && pattern.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isWellFormedTags(tags: unknown): tags is string[][] {
  if (!Array.isArray(tags) || tags.length > MAX_EVENT_TAGS) return false;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length > MAX_TAG_ITEMS) return false;
    for (const item of tag) {
      if (typeof item !== "string" || item.length > MAX_TAG_ITEM_CHARS) return false;
    }
  }
  return true;
}

function isWithinContentBudget(content: unknown): content is string {
  if (typeof content !== "string") return false;
  // Every UTF-8 byte is at least one code unit, so a short string can never exceed the budget;
  // only strings that could plausibly exceed it pay for the encode.
  if (content.length > MAX_EVENT_CONTENT_BYTES) return false;
  if (content.length * 4 <= MAX_EVENT_CONTENT_BYTES) return true;
  return new TextEncoder().encode(content).length <= MAX_EVENT_CONTENT_BYTES;
}

/** id / pubkey / sig carry the exact hex widths NIP-01 defines. */
function hasWellFormedIdentity(e: Record<string, unknown>): boolean {
  return isHex(e.id, HEX_64) && isHex(e.pubkey, HEX_64) && isHex(e.sig, HEX_128);
}

/** `kind` is an integer we subscribed to (when a filter is given) and `created_at` is sane. */
function hasExpectedKindAndTime(
  e: Record<string, unknown>,
  expectedKinds?: ReadonlyArray<number>
): boolean {
  if (!isNonNegativeInteger(e.kind) || !isNonNegativeInteger(e.created_at)) return false;
  if (!expectedKinds || expectedKinds.length === 0) return true;
  return expectedKinds.includes(e.kind);
}

/**
 * Structural check for an inbound NIP-01 event. `expectedKinds` (the subscription filter) is
 * enforced when given: a kind we did not ask for is dropped without touching the signature.
 */
export function isWellFormedRelayEvent(
  value: unknown,
  expectedKinds?: ReadonlyArray<number>
): value is SignedNostrEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return (
    hasWellFormedIdentity(e) &&
    hasExpectedKindAndTime(e, expectedKinds) &&
    isWithinContentBudget(e.content) &&
    isWellFormedTags(e.tags)
  );
}
