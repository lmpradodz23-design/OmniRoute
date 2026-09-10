import { getErrorMessage } from "./api";

/**
 * User-facing presentation of an API error body (U4).
 *
 * Management routes answer failures in three shapes:
 *   `{ error: "text" }`
 *   `{ error: { code, message, … } }`          (e.g. PATCH /api/settings)
 *   `{ error: { message, details: [...] } }`   (validation)
 * Rendering `data.error` directly shows a raw technical sentence — or, for the object
 * shapes, throws in React. `presentApiError` always yields a string headline, prefers a
 * translated message keyed by `error.code`, and keeps the technical text as `detail`
 * so the UI can offer it behind "show details".
 */

/** `error.code` → key in the `common.apiErrors` message namespace. */
export const API_ERROR_CODE_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  PASSWORD_REQUIRED: "apiErrors.passwordRequired",
  PASSWORD_MISMATCH: "apiErrors.passwordMismatch",
  INVALID_JSON: "apiErrors.invalidJson",
  VALIDATION_ERROR: "apiErrors.validation",
  SETTINGS_REVISION_CONFLICT: "apiErrors.settingsRevisionConflict",
  OIDC_ALLOWED_SUBJECTS_REQUIRED: "apiErrors.oidcAllowedSubjectsRequired",
  PAID_MODEL_TARGET_BLOCKED: "apiErrors.paidModelTargetBlocked",
};

export interface PresentedApiError {
  /** Short, user-facing headline — never JSON, never an object. */
  message: string;
  /** `error.code` when the server sent one. */
  code: string | null;
  /** The technical server text when it differs from `message`; for "show details". */
  detail: string | null;
}

export interface PresentApiErrorOptions {
  /** Returns the translated text for a `common.apiErrors.*` key, or null when missing. */
  translate?: (key: string) => string | null;
  /** Headline when the body carries nothing usable. */
  fallback: string;
  status?: number;
}

export function getApiErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== "object") return null;
  const code = (err as Record<string, unknown>).code;
  return typeof code === "string" && code.trim() ? code : null;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function presentApiError(
  body: unknown,
  { translate, fallback, status }: PresentApiErrorOptions
): PresentedApiError {
  const code = getApiErrorCode(body);
  const raw = getErrorMessage(body, status, fallback);
  // `getErrorMessage` serialises message-less objects; that is detail, not a headline.
  const technical = looksLikeJson(raw) ? raw : raw === fallback ? null : raw;
  const headlineFromServer = technical && !looksLikeJson(technical) ? technical : fallback;

  const key = code ? API_ERROR_CODE_MESSAGE_KEYS[code] : undefined;
  const translated = key && translate ? translate(key) : null;
  const message = translated && translated.trim() ? translated : headlineFromServer;

  const detail = technical && technical !== message ? technical : null;
  return { message, code, detail };
}
