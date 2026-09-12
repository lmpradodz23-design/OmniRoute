/**
 * Loop Engine / Buzz Hub pages — readable presentation of a failed management-API call.
 *
 * The routes answer with either the legacy `{ error: string }` body or the typed
 * `{ error: { code, message, type } }` envelope (`createErrorResponse`); both are accepted
 * through `readFetchErrorMessage`. The headline is always translated copy keyed by the
 * HTTP status (409 conflict, 400 rejected, 404 gone, otherwise the status code); the
 * server sentence is kept apart as `detail`. A thrown transport error (network down,
 * DNS, CORS) is never rendered — `err.message` carries hosts and ports — it becomes the
 * translated "could not be reached" sentence instead.
 *
 * Both page namespaces (`loopEngine`, `buzzHub`) define the keys used here:
 * `errorNetwork`, `errorConflict`, `errorRejected`, `errorGone`, `errorHttp`.
 */
import { readFetchErrorMessage } from "@/shared/utils/fetchError";

export interface UiFailure {
  /** Translated headline: "<what failed>. <why>". */
  message: string;
  /** The server's own sentence, when it sent one; rendered as secondary detail. */
  detail: string | null;
}

export type FailureTranslate = (key: string, values?: Record<string, string | number>) => string;

function reasonKey(status: number): string {
  if (status === 409) return "errorConflict";
  if (status === 400 || status === 422) return "errorRejected";
  if (status === 404) return "errorGone";
  return "errorHttp";
}

/** Failure for a response with `!res.ok`; `headlineKey` names the action that failed. */
export async function describeFailedResponse(
  res: Response,
  t: FailureTranslate,
  headlineKey: string
): Promise<UiFailure> {
  const detail = await readFetchErrorMessage(res, "");
  return {
    message: `${t(headlineKey)} ${t(reasonKey(res.status), { status: res.status })}`,
    detail: detail || null,
  };
}

/** Failure for a `fetch` that threw — the transport message is deliberately dropped. */
export function describeThrown(t: FailureTranslate, headlineKey: string): UiFailure {
  return { message: `${t(headlineKey)} ${t("errorNetwork")}`, detail: null };
}
