"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { ErrorBanner } from "../loop/ErrorBanner";
import { FlagDisabledNotice } from "../loop/FlagDisabledNotice";
import { LoadingState } from "../loop/LoadingState";
import { BuzzCounts } from "./BuzzCounts";
import { FlushControls } from "./FlushControls";
import { IdentityCard } from "./IdentityCard";
import { RelayUrlCard } from "./RelayUrlCard";
import { useBuzzActions, useBuzzHub } from "./useBuzzHub";

const code = (chunks: ReactNode) => <code className="font-mono">{chunks}</code>;
const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

const BADGE_ON = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
const BADGE_OFF = "bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-300";

export default function BuzzHubPage() {
  const t = useTranslations("buzzHub");
  const hub = useBuzzHub();
  const actions = useBuzzActions(hub);
  const { status } = hub;
  const enabled = status?.enabled === true;
  const settled = !hub.loading && hub.loaded;

  return (
    <div className="space-y-6" data-testid="buzz-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-text-primary">{t("title")}</h1>
        {settled && (
          <span
            data-testid="buzz-enabled-badge"
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${enabled ? BADGE_ON : BADGE_OFF}`}
          >
            {enabled ? t("badgeEnabled") : t("badgeDisabled")}
          </span>
        )}
      </div>
      <p className="-mt-3 text-sm text-text-muted">{t.rich("intro", { strong })}</p>

      {hub.loading && <LoadingState label={t("loading")} testId="buzz-loading" />}

      {!hub.loading && hub.error && (
        <ErrorBanner
          failure={hub.error}
          retryLabel={t("retry")}
          onRetry={() => void hub.retry()}
          testId="buzz-error"
        />
      )}

      {settled && !enabled && (
        <FlagDisabledNotice
          flagKey="BUZZ_HUB_ENABLED"
          title={t("disabledTitle")}
          description={t.rich("disabledDesc", { code })}
          linkLabel={t("openFeatureFlags")}
          testId="buzz-disabled"
        />
      )}

      {settled && status && (
        <>
          <RelayUrlCard
            key={status.relayUrl}
            relayUrl={status.relayUrl}
            saving={actions.savingRelay}
            onSave={actions.saveRelay}
          />
          <IdentityCard pubkey={status.agentPubkey} />
          <BuzzCounts counts={status.counts} />
          <FlushControls
            enabled={enabled}
            flushing={actions.flushing}
            message={actions.flushMessage}
            onFlush={() => void actions.flush()}
          />
        </>
      )}
    </div>
  );
}
