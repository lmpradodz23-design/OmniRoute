"use client";

/**
 * Loop Engine / Buzz Hub pages — inline error banner: translated headline, optional
 * server detail and a retry action. `testId` prefixes the stable data-testids
 * (`<testId>`, `<testId>-detail`, `<testId>-retry`).
 */
import type { UiFailure } from "./apiFailure";

interface ErrorBannerProps {
  failure: UiFailure;
  retryLabel: string;
  onRetry?: () => void;
  testId: string;
}

export function ErrorBanner({ failure, retryLabel, onRetry, testId }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
    >
      <div className="min-w-0">
        <p>{failure.message}</p>
        {failure.detail && (
          <p
            data-testid={`${testId}-detail`}
            className="mt-1 break-words font-mono text-xs opacity-80"
          >
            {failure.detail}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
          className="shrink-0 font-medium underline hover:no-underline"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
