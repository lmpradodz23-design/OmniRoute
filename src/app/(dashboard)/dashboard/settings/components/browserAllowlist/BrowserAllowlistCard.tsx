"use client";

/**
 * Settings → Security — Browser Use domain allowlist card.
 *
 * Lives on the Security settings page because BROWSER_USE_ENABLED is a `security`-category flag
 * and the allowlist is the policy boundary of browser automation; there is no dedicated Browser
 * page. The list is editable while the flag is off (preparing it before enabling is the point),
 * and the card says plainly that it has no effect until the flag is on.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { ErrorBanner } from "../../../loop/ErrorBanner";
import { FlagDisabledNotice } from "../../../loop/FlagDisabledNotice";
import { LoadingState } from "../../../loop/LoadingState";
import { AllowlistEditor } from "./AllowlistEditor";
import { useBrowserAllowlist } from "./useBrowserAllowlist";

const code = (chunks: ReactNode) => <code className="font-mono">{chunks}</code>;

const BADGE_ON = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
const BADGE_OFF = "bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-300";

export default function BrowserAllowlistCard() {
  const t = useTranslations("browserAllowlist");
  const list = useBrowserAllowlist();
  const { state } = list;

  return (
    <section
      data-testid="browser-allowlist-card"
      aria-labelledby="browser-allowlist-title"
      className="space-y-4 rounded-xl border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="browser-allowlist-title" className="text-lg font-semibold">
          {t("title")}
        </h3>
        {state && (
          <span
            data-testid="browser-allowlist-flag-badge"
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${state.enabled ? BADGE_ON : BADGE_OFF}`}
          >
            {state.enabled ? t("badgeEnabled") : t("badgeDisabled")}
          </span>
        )}
      </div>
      <p className="-mt-2 text-sm text-text-muted">{t("intro")}</p>

      {list.loading && <LoadingState label={t("loading")} testId="browser-allowlist-loading" />}

      {!list.loading && list.loadError && (
        <ErrorBanner
          failure={list.loadError}
          retryLabel={t("retry")}
          onRetry={() => void list.retry()}
          testId="browser-allowlist-load-error"
        />
      )}

      {!list.loading && state && (
        <>
          {!state.enabled && (
            <FlagDisabledNotice
              flagKey="BROWSER_USE_ENABLED"
              title={t("disabledTitle")}
              description={t.rich("disabledDesc", { code })}
              linkLabel={t("openFeatureFlags")}
              testId="browser-allowlist-disabled"
            />
          )}
          {list.saveError && (
            <ErrorBanner
              failure={list.saveError}
              retryLabel={t("retry")}
              testId="browser-allowlist-save-error"
            />
          )}
          {list.saved && (
            <p
              role="status"
              data-testid="browser-allowlist-saved"
              className="text-sm text-emerald-700 dark:text-emerald-300"
            >
              {t("saved")}
            </p>
          )}
          <AllowlistEditor
            key={state.allowedDomains.join("\n")}
            savedDomains={state.allowedDomains}
            maxDomains={state.maxDomains}
            saving={list.saving}
            rejected={list.rejected}
            onSave={list.save}
          />
        </>
      )}
    </section>
  );
}
