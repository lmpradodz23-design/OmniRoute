"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { DecisionConfirmModal } from "./DecisionConfirmModal";
import { ErrorBanner } from "./ErrorBanner";
import { FlagDisabledNotice } from "./FlagDisabledNotice";
import { LoadingState } from "./LoadingState";
import { RunList } from "./RunCard";
import { StartRunForm } from "./StartRunForm";
import type { LoopDecision, LoopRun, LoopStep, PendingDecision } from "./types";
import { useLoopRuns } from "./useLoopRuns";

const code = (chunks: ReactNode) => <code className="font-mono">{chunks}</code>;

export default function LoopEnginePage() {
  const t = useTranslations("loopEngine");
  const loop = useLoopRuns();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<PendingDecision | null>(null);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const requestDecision = (run: LoopRun, step: LoopStep, decision: LoopDecision) =>
    setPending({ runId: run.id, step, decision });

  const confirmDecision = async () => {
    if (!pending) return;
    const { runId, step, decision } = pending;
    setPending(null);
    await loop.decide(runId, step.id, decision);
  };

  const ready = !loop.loading && !loop.disabled;
  return (
    <div className="space-y-6" data-testid="loop-page">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-text-muted">{t.rich("intro", { code })}</p>
      </div>

      {loop.loading && <LoadingState label={t("loading")} testId="loop-loading" />}

      {!loop.loading && loop.disabled && (
        <FlagDisabledNotice
          flagKey="LOOP_ENGINE_ENABLED"
          title={t("disabledTitle")}
          description={t.rich("disabledDesc", { code })}
          linkLabel={t("openFeatureFlags")}
          testId="loop-disabled"
        />
      )}

      {ready && <StartRunForm starting={loop.starting} onStart={loop.startRun} />}

      {!loop.loading && loop.error && (
        <ErrorBanner
          failure={loop.error}
          retryLabel={t("retry")}
          onRetry={() => void loop.retry()}
          testId="loop-error"
        />
      )}

      {ready && (
        <RunList
          runs={loop.runs}
          expanded={expanded}
          busyRun={loop.busyRun}
          onToggle={toggle}
          onAdvance={(run) => void loop.advance(run)}
          onDecide={requestDecision}
        />
      )}

      <DecisionConfirmModal
        pending={pending}
        busy={pending ? loop.busyRun === pending.runId : false}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmDecision()}
      />
    </div>
  );
}
