"use client";

/**
 * Buzz Hub page — outbox/inbox counters (pending, published, failed, dead, received).
 *
 * `failed` and `dead` are distinct on purpose: a failed entry is still scheduled for another
 * attempt, a dead one hit the retry ceiling and will never be retried on its own.
 */
import { useTranslations } from "next-intl";

import type { BuzzCounts as BuzzCountsShape } from "./useBuzzHub";

interface StatProps {
  testId: string;
  label: string;
  value: number;
  tone?: string;
  help?: string;
}

function Stat({ testId, label, value, tone, help }: StatProps) {
  return (
    <div
      data-testid={testId}
      title={help}
      className="rounded-xl border border-border bg-bg-subtle px-4 py-3"
    >
      <p className={`text-2xl font-semibold ${tone ?? "text-text-primary"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  );
}

export function BuzzCounts({ counts }: { counts: BuzzCountsShape }) {
  const t = useTranslations("buzzHub");
  return (
    <div data-testid="buzz-counts" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat
        testId="buzz-count-outbox-pending"
        label={t("countOutboxPending")}
        value={counts.outboxPending}
        tone={counts.outboxPending > 0 ? "text-amber-600 dark:text-amber-300" : undefined}
      />
      <Stat
        testId="buzz-count-outbox-published"
        label={t("countOutboxPublished")}
        value={counts.outboxPublished}
        tone="text-emerald-600 dark:text-emerald-300"
      />
      <Stat
        testId="buzz-count-outbox-failed"
        label={t("countOutboxFailed")}
        value={counts.outboxFailed}
        tone={counts.outboxFailed > 0 ? "text-red-600 dark:text-red-300" : undefined}
      />
      <Stat
        testId="buzz-count-outbox-dead"
        label={t("countOutboxDead")}
        value={counts.outboxDead}
        tone={counts.outboxDead > 0 ? "text-red-600 dark:text-red-300" : undefined}
        help={t("countOutboxDeadHelp")}
      />
      <Stat
        testId="buzz-count-inbox-received"
        label={t("countInboxReceived")}
        value={counts.inboxReceived}
      />
    </div>
  );
}
