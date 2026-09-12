"use client";

/**
 * Loop Engine page — one run: collapsible header (pattern, translated status badge,
 * budget/usage line) and, when expanded, the "advance one step" action plus the step
 * list (StepRow). `RunList` renders the empty state or the cards.
 */
import { useTranslations } from "next-intl";

import { StepRow } from "./StepRow";
import type { LoopDecision, LoopRun, LoopRunStatus, LoopStep } from "./types";

const STATUS_STYLE: Record<LoopRunStatus, string> = {
  report_only: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  awaiting_approval: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  verifying: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  escalated: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  aborted: "bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-300",
};

interface RunCardProps {
  run: LoopRun;
  open: boolean;
  busy: boolean;
  onToggle: (runId: string) => void;
  onAdvance: (run: LoopRun) => void;
  onDecide: (run: LoopRun, step: LoopStep, decision: LoopDecision) => void;
}

export function RunCard({ run, open, busy, onToggle, onAdvance, onDecide }: RunCardProps) {
  const t = useTranslations("loopEngine");
  const canDecide = run.status === "awaiting_approval";

  return (
    <div data-testid={`loop-run-${run.id}`} className="rounded-xl border border-border bg-card">
      <button
        type="button"
        data-testid={`loop-run-toggle-${run.id}`}
        onClick={() => onToggle(run.id)}
        aria-expanded={open}
        aria-label={t("runDetailsAria", { pattern: run.pattern })}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-text-primary">{run.pattern}</span>
            <span
              data-testid={`loop-run-status-${run.id}`}
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[run.status]}`}
            >
              {t(`status.${run.status}`)}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-text-muted">
            {t("runMeta", {
              phase: run.phase,
              tokens: run.usage.tokens,
              maxTokens: run.budget.maxTokens,
              attempts: run.usage.attempts,
              maxAttempts: run.budget.maxAttempts,
              id: run.id,
            })}
          </p>
        </div>
        <span className="material-symbols-outlined shrink-0 text-text-muted" aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid={`loop-advance-${run.id}`}
              onClick={() => onAdvance(run)}
              disabled={busy}
              aria-busy={busy || undefined}
              className="rounded-lg border border-border bg-bg-subtle px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/5"
            >
              {busy ? t("working") : t("advance")}
            </button>
          </div>
          {run.steps.length === 0 ? (
            <p data-testid={`loop-no-steps-${run.id}`} className="text-sm text-text-muted">
              {t("noSteps")}
            </p>
          ) : (
            <ul className="space-y-2">
              {run.steps.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  canDecide={canDecide && step.status === "proposed"}
                  busy={busy}
                  onDecide={(s, decision) => onDecide(run, s, decision)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface RunListProps extends Omit<RunCardProps, "run" | "open" | "busy"> {
  runs: LoopRun[];
  expanded: ReadonlySet<string>;
  busyRun: string | null;
}

export function RunList({ runs, expanded, busyRun, ...handlers }: RunListProps) {
  const t = useTranslations("loopEngine");
  if (runs.length === 0) {
    return (
      <div data-testid="loop-empty" className="py-12 text-center text-text-muted">
        <span className="material-symbols-outlined text-4xl" aria-hidden="true">
          sync
        </span>
        <p className="mt-2 text-sm">{t("emptyTitle")}</p>
        <p className="mt-1 text-xs">{t("emptyHint")}</p>
      </div>
    );
  }
  return (
    <div data-testid="loop-run-list" className="space-y-3">
      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          open={expanded.has(run.id)}
          busy={busyRun === run.id}
          {...handlers}
        />
      ))}
    </div>
  );
}
