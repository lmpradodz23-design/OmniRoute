"use client";

/**
 * Loop Engine / Buzz Hub pages — initial-load skeleton announced as a busy polite
 * status region (screen readers get `label`; sighted users get the pulse).
 */
interface LoadingStateProps {
  label: string;
  testId: string;
}

export function LoadingState({ label, testId }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={testId}
      className="h-24 animate-pulse rounded-xl bg-black/[0.04] dark:bg-white/5"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
