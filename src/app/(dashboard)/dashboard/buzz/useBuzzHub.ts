"use client";

/**
 * Buzz Hub page — data hooks over `/api/buzz` and `/api/buzz/flush`.
 *
 * `useBuzzHub` owns the status (initial load, retry, readable failures);
 * `useBuzzActions` owns the mutations (save relay URL, flush the outbox). Every failure
 * is stored as a translated `UiFailure` (loop/apiFailure.ts) — the page never renders a
 * raw `err.message`. State is only written after a response arrives, so the mount
 * effect never calls setState synchronously (react-hooks/set-state-in-effect).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  describeFailedResponse,
  describeThrown,
  type FailureTranslate,
  type UiFailure,
} from "../loop/apiFailure";

export interface BuzzCounts {
  outboxPending: number;
  outboxPublished: number;
  outboxFailed: number;
  /** Permanent failures: the retry ceiling was reached, never retried automatically. */
  outboxDead: number;
  inboxReceived: number;
}

export interface BuzzStatus {
  enabled: boolean;
  /** Empty until an operator configures a relay (BUZZ_RELAY_URL is opt-in). */
  relayUrl: string;
  relayConfigured: boolean;
  /** Public Nostr key; null while the identity has not been created yet. */
  agentPubkey: string | null;
  identityStatus: string;
  counts: BuzzCounts;
}

interface FlushResult {
  published?: number;
  failed?: number;
  skipped?: boolean;
  reason?: string;
}

// Discriminated by a string tag, not a boolean: the project compiles with `strict: false`,
// and without strictNullChecks TypeScript does not narrow a union on a boolean literal
// (the `ok: true` / `ok: false` shape reported TS2339 on the failure branch).
type LoadResult =
  { kind: "loaded"; status: BuzzStatus | null } | { kind: "failed"; failure: UiFailure };

async function loadStatus(t: FailureTranslate): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch("/api/buzz");
  } catch {
    return { kind: "failed", failure: describeThrown(t, "loadFailed") };
  }
  // Tolerate a flag-gated status route: 404 renders the "turned off" notice alone.
  if (res.status === 404) return { kind: "loaded", status: null };
  if (!res.ok)
    return { kind: "failed", failure: await describeFailedResponse(res, t, "loadFailed") };
  return { kind: "loaded", status: (await res.json()) as BuzzStatus };
}

function useBuzzTranslate() {
  const t = useTranslations("buzzHub");
  const translate = useCallback<FailureTranslate>((key, values) => t(key, values), [t]);
  return { t, translate };
}

export function useBuzzHub() {
  const { translate } = useBuzzTranslate();
  const [status, setStatus] = useState<BuzzStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiFailure | null>(null);

  const apply = useCallback((result: LoadResult) => {
    if (result.kind === "failed") {
      setError(result.failure);
      return;
    }
    setStatus(result.status);
    setLoaded(true);
  }, []);

  const reload = useCallback(async () => {
    apply(await loadStatus(translate));
  }, [apply, translate]);

  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await reload();
    } finally {
      setLoading(false);
    }
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadStatus(translate);
      if (cancelled) return;
      apply(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, translate]);

  return { status, loaded, loading, error, setStatus, setError, reload, retry };
}

interface ActionDeps {
  reload: () => Promise<void>;
  setStatus: (status: BuzzStatus) => void;
  setError: (failure: UiFailure | null) => void;
}

function describeFlush(data: FlushResult, t: FailureTranslate): string {
  if (data.skipped) {
    return /BUZZ_HUB_ENABLED/.test(data.reason ?? "")
      ? t("flushSkippedFlagOff")
      : t("flushNothingPending");
  }
  return t("flushResult", { published: data.published ?? 0, failed: data.failed ?? 0 });
}

export function useBuzzActions({ reload, setStatus, setError }: ActionDeps) {
  const { translate } = useBuzzTranslate();
  const [savingRelay, setSavingRelay] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [flushMessage, setFlushMessage] = useState<string | null>(null);

  const saveRelay = useCallback(
    async (relayUrl: string): Promise<boolean> => {
      setSavingRelay(true);
      setError(null);
      try {
        const res = await fetch("/api/buzz", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relayUrl }),
        });
        if (!res.ok) {
          setError(await describeFailedResponse(res, translate, "saveRelayFailed"));
          return false;
        }
        setStatus((await res.json()) as BuzzStatus);
        return true;
      } catch {
        setError(describeThrown(translate, "saveRelayFailed"));
        return false;
      } finally {
        setSavingRelay(false);
      }
    },
    [setError, setStatus, translate]
  );

  const flush = useCallback(async () => {
    setFlushing(true);
    setFlushMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/buzz/flush", { method: "POST" });
      if (!res.ok) {
        setError(await describeFailedResponse(res, translate, "flushFailed"));
        return;
      }
      setFlushMessage(
        describeFlush((await res.json().catch(() => ({}))) as FlushResult, translate)
      );
      await reload();
    } catch {
      setError(describeThrown(translate, "flushFailed"));
    } finally {
      setFlushing(false);
    }
  }, [reload, setError, translate]);

  return { savingRelay, flushing, flushMessage, saveRelay, flush };
}
