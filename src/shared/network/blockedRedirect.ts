/**
 * Redirect refusal shared by the pinned outbound clients (`hardenedWebhookFetch`,
 * `guardedFetch`). Both dispatch with `redirect: "manual"` and never follow a 3xx: the hop
 * could point at an internal service the target validation never saw. The unread body is
 * cancelled and the hop is surfaced as an `OutboundUrlGuardError` (no body, no content).
 */
import { OutboundUrlGuardError } from "./outboundUrlGuard";
import { normalizeHost } from "./privateHost";

/** The response surface the refusal needs; matches both undici's and the DOM `Response`. */
interface RedirectCandidateResponse {
  status: number;
  body: { cancel(reason?: unknown): Promise<void> } | null;
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** Cancel the unread body and throw the blocked-redirect guard error for this hop. */
export async function rejectBlockedRedirect(
  res: RedirectCandidateResponse,
  method: string,
  url: URL
): Promise<never> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
  throw new OutboundUrlGuardError(
    `Redirect blocked for ${method} ${url.toString()} (${res.status})`,
    {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: normalizeHost(url.hostname),
    }
  );
}
