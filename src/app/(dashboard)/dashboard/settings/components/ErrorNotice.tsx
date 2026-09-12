"use client";

/**
 * Inline API-error / status notice shared by the Security tab and its password form (U4):
 * a friendly headline (role=alert for errors, role=status otherwise) with the technical
 * server text tucked behind a "details" disclosure.
 */

import type { PresentedApiError } from "@/shared/utils/apiErrorPresentation";

export type StatusNotice = {
  type: "" | "error" | "success";
  message: string;
  detail?: string | null;
};

/** U4: friendly headline (role=alert) with the technical server text behind "details". */
export function ErrorNotice({
  error,
  showDetailsLabel,
  tone = "error",
}: {
  error: PresentedApiError | StatusNotice;
  showDetailsLabel: string;
  tone?: "error" | "success";
}) {
  if (!error.message) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`text-sm ${tone === "error" ? "text-red-500" : "text-green-500"}`}
    >
      <p>{error.message}</p>
      {tone === "error" && error.detail ? (
        <details className="mt-1 text-xs text-text-muted">
          <summary className="cursor-pointer">{showDetailsLabel}</summary>
          <code className="block mt-1 break-all">{error.detail}</code>
        </details>
      ) : null}
    </div>
  );
}
