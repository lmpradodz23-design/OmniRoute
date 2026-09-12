"use client";

/**
 * Loop Engine / Buzz Hub pages (and the Browser Use allowlist card in Settings → Security) —
 * "this module is turned off" notice: names the feature
 * flag and deep-links to the flag grid pre-filtered on it
 * (`/dashboard/settings/feature-flags?q=<FLAG>`, handled by FeatureFlagsGrid).
 */
import type { ReactNode } from "react";

interface FlagDisabledNoticeProps {
  flagKey: "LOOP_ENGINE_ENABLED" | "BUZZ_HUB_ENABLED" | "BROWSER_USE_ENABLED";
  title: string;
  description: ReactNode;
  linkLabel: string;
  testId: string;
}

export function FlagDisabledNotice({
  flagKey,
  title,
  description,
  linkLabel,
  testId,
}: FlagDisabledNoticeProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <div className="flex items-start gap-3">
        <span
          className="material-symbols-outlined text-amber-600 dark:text-amber-300"
          aria-hidden="true"
        >
          toggle_off
        </span>
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{title}</p>
          <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">{description}</p>
          <a
            href={`/dashboard/settings/feature-flags?q=${flagKey}`}
            data-testid={`${testId}-link`}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white/70 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/20"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              tune
            </span>
            {linkLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
