"use client";

/**
 * Loop Engine page — one proposed step of a run: title, proposed effect and, while the
 * run awaits approval, the Approve / Reject actions (both go through the page's
 * ConfirmModal before any request is sent).
 */
import { useTranslations } from "next-intl";

import type { LoopDecision, LoopStep } from "./types";

interface StepRowProps {
  step: LoopStep;
  canDecide: boolean;
  busy: boolean;
  onDecide: (step: LoopStep, decision: LoopDecision) => void;
}

export function StepRow({ step, canDecide, busy, onDecide }: StepRowProps) {
  const t = useTranslations("loopEngine");
  const effect = step.proposedEffect;

  return (
    <li
      data-testid={`loop-step-${step.id}`}
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-2"
    >
      <div className="min-w-0">
        <p className="text-sm text-text-primary">
          {t("stepTitle", { index: step.index + 1, title: step.title })}
        </p>
        {effect && effect.kind !== "none" && (
          <p className="mt-0.5 text-xs text-text-muted">
            {t.rich("proposedEffect", {
              kind: effect.kind,
              summary: effect.summary,
              mono: (chunks) => <span className="font-mono">{chunks}</span>,
            })}
          </p>
        )}
      </div>
      {canDecide ? (
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            data-testid={`loop-approve-${step.id}`}
            onClick={() => onDecide(step, "approve")}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {t("approve")}
          </button>
          <button
            type="button"
            data-testid={`loop-reject-${step.id}`}
            onClick={() => onDecide(step, "reject")}
            disabled={busy}
            className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            {t("reject")}
          </button>
        </div>
      ) : (
        <span
          data-testid={`loop-step-status-${step.id}`}
          className="shrink-0 text-xs text-text-muted"
        >
          {t(`stepStatus.${step.status}`)}
        </span>
      )}
    </li>
  );
}
