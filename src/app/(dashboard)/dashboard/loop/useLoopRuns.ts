"use client";

/**
 * Loop Engine page — data hooks over `/api/loop`.
 *
 * `useLoopRunList` owns the list (initial load, flag-off detection via 404, retry);
 * `useLoopRunActions` owns the mutations (start / advance / approve-reject) and reloads
 * the list after each server answer. `useLoopRuns` composes both for the page. Every
 * failure is stored as a translated `UiFailure` (see apiFailure.ts) — the page never
 * renders a raw `err.message`. State is only written after a response arrives, so the
 * mount effect never calls setState synchronously (react-hooks/set-state-in-effect).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  describeFailedResponse,
  describeThrown,
  type FailureTranslate,
  type UiFailure,
} from "./apiFailure";
import type { LoopDecision, LoopRun } from "./types";

// Discriminated by a string tag, not a boolean: the project compiles with `strict: false`,
// and without strictNullChecks TypeScript does not narrow a union on a boolean literal
// (the `ok: true` / `ok: false` shape reported TS2339 on the failure branch).
type LoadResult =
  { kind: "loaded"; disabled: boolean; runs: LoopRun[] } | { kind: "failed"; failure: UiFailure };

const JSON_HEADERS = { "Content-Type": "application/json" };

async function loadRuns(t: FailureTranslate): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch("/api/loop");
  } catch {
    return { kind: "failed", failure: describeThrown(t, "loadFailed") };
  }
  // The route answers 404 when LOOP_ENGINE_ENABLED is off (no id involved).
  if (res.status === 404) return { kind: "loaded", disabled: true, runs: [] };
  if (!res.ok)
    return { kind: "failed", failure: await describeFailedResponse(res, t, "loadFailed") };
  const data = (await res.json().catch(() => ({}))) as { runs?: unknown };
  const runs = Array.isArray(data.runs) ? (data.runs as LoopRun[]) : [];
  return { kind: "loaded", disabled: false, runs };
}

function useFailureTranslate(): FailureTranslate {
  const t = useTranslations("loopEngine");
  return useCallback<FailureTranslate>((key, values) => t(key, values), [t]);
}

export function useLoopRunList() {
  const translate = useFailureTranslate();
  const [runs, setRuns] = useState<LoopRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<UiFailure | null>(null);

  // Applies a load result; an action error already on screen is kept (the caller clears
  // it before a new attempt), so a post-action reload never hides what just failed.
  const apply = useCallback((result: LoadResult) => {
    if (result.kind === "failed") {
      setError(result.failure);
      return;
    }
    setDisabled(result.disabled);
    setRuns(result.runs);
  }, []);

  const reload = useCallback(async () => {
    apply(await loadRuns(translate));
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
      const result = await loadRuns(translate);
      if (cancelled) return;
      apply(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, translate]);

  return { runs, loading, disabled, error, setError, reload, retry };
}

interface ActionDeps {
  reload: () => Promise<void>;
  setError: (failure: UiFailure | null) => void;
}

export function useLoopRunActions({ reload, setError }: ActionDeps) {
  const translate = useFailureTranslate();
  const [starting, setStarting] = useState(false);
  const [busyRun, setBusyRun] = useState<string | null>(null);

  // Runs one mutation: clears the previous error, records a readable failure for a
  // non-OK answer, reloads the list whenever the server answered at all.
  const perform = useCallback(
    async (headlineKey: string, request: () => Promise<Response>): Promise<boolean> => {
      setError(null);
      let res: Response;
      try {
        res = await request();
      } catch {
        setError(describeThrown(translate, headlineKey));
        return false;
      }
      if (!res.ok) setError(await describeFailedResponse(res, translate, headlineKey));
      await reload();
      return res.ok;
    },
    [reload, setError, translate]
  );

  const startRun = useCallback(
    async (pattern: string): Promise<boolean> => {
      setStarting(true);
      try {
        return await perform("startFailed", () =>
          fetch("/api/loop", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ pattern }),
          })
        );
      } finally {
        setStarting(false);
      }
    },
    [perform]
  );

  // `expectedSequenceNumber` is the version this client rendered: a 409 means the run
  // moved on in the meantime and the list is reloaded instead of applying a stale step.
  const advance = useCallback(
    async (run: Pick<LoopRun, "id" | "sequenceNumber">) => {
      setBusyRun(run.id);
      try {
        await perform("advanceFailed", () =>
          fetch(`/api/loop/${encodeURIComponent(run.id)}/advance`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ expectedSequenceNumber: run.sequenceNumber }),
          })
        );
      } finally {
        setBusyRun(null);
      }
    },
    [perform]
  );

  const decide = useCallback(
    async (runId: string, stepId: string, decision: LoopDecision) => {
      setBusyRun(runId);
      try {
        await perform("decideFailed", () =>
          fetch(`/api/loop/${encodeURIComponent(runId)}/approve`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ stepId, decision }),
          })
        );
      } finally {
        setBusyRun(null);
      }
    },
    [perform]
  );

  return { starting, busyRun, startRun, advance, decide };
}

export function useLoopRuns() {
  const list = useLoopRunList();
  const actions = useLoopRunActions({ reload: list.reload, setError: list.setError });
  return { ...list, ...actions };
}
