"use client";

/**
 * Settings → Security — Browser Use domain allowlist: data hook over `/api/browser/allowlist`.
 *
 * Loads `{ allowedDomains, enabled, maxDomains }`, saves a whole replacement list, and keeps
 * every failure as a translated `UiFailure` (the Loop/Buzz helper) — never a raw `err.message`.
 * A 400 `invalid_domains` answer carries only `{ index, reason }` per rejected entry; the hook
 * maps the index back onto the list the operator sent so the card can name the entry.
 *
 * Results are discriminated by a string `kind`, not a boolean: the project compiles with
 * `strict: false`, where a boolean-literal union does not narrow.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  describeFailedResponse,
  describeThrown,
  type FailureTranslate,
  type UiFailure,
} from "../../../loop/apiFailure";

export interface BrowserAllowlistState {
  allowedDomains: string[];
  /** BROWSER_USE_ENABLED — the list has no effect while this is false. */
  enabled: boolean;
  maxDomains: number;
}

export type DomainRejectionReason =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "non_ascii"
  | "ip_literal"
  | "single_label"
  | "invalid_label";

export interface RejectedDomain {
  domain: string;
  reason: DomainRejectionReason;
}

type LoadResult =
  { kind: "loaded"; state: BrowserAllowlistState } | { kind: "failed"; failure: UiFailure };

type SaveResult =
  | { kind: "saved"; state: BrowserAllowlistState }
  | { kind: "rejected"; rejected: RejectedDomain[]; failure: UiFailure }
  | { kind: "failed"; failure: UiFailure };

const ENDPOINT = "/api/browser/allowlist";

async function loadAllowlist(t: FailureTranslate): Promise<LoadResult> {
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) {
      return { kind: "failed", failure: await describeFailedResponse(res, t, "loadFailed") };
    }
    return { kind: "loaded", state: (await res.json()) as BrowserAllowlistState };
  } catch {
    return { kind: "failed", failure: describeThrown(t, "loadFailed") };
  }
}

async function readRejected(res: Response, sent: string[]): Promise<RejectedDomain[]> {
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    invalid?: Array<{ index: number; reason: DomainRejectionReason }>;
  } | null;
  if (body?.code !== "invalid_domains" || !Array.isArray(body.invalid)) return [];
  return body.invalid
    .filter((entry) => typeof sent[entry.index] === "string")
    .map((entry) => ({ domain: sent[entry.index], reason: entry.reason }));
}

async function saveAllowlist(t: FailureTranslate, domains: string[]): Promise<SaveResult> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedDomains: domains }),
    });
    if (res.ok) return { kind: "saved", state: (await res.json()) as BrowserAllowlistState };
    const rejected = await readRejected(res.clone(), domains);
    const failure = await describeFailedResponse(res, t, "saveFailed");
    return rejected.length > 0
      ? { kind: "rejected", rejected, failure }
      : { kind: "failed", failure };
  } catch {
    return { kind: "failed", failure: describeThrown(t, "saveFailed") };
  }
}

export function useBrowserAllowlist() {
  const t = useTranslations("browserAllowlist");
  const translate = useCallback<FailureTranslate>((key, values) => t(key, values), [t]);
  const [state, setState] = useState<BrowserAllowlistState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<UiFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<UiFailure | null>(null);
  const [rejected, setRejected] = useState<RejectedDomain[]>([]);
  const [saved, setSaved] = useState(false);

  const applyLoad = useCallback((result: LoadResult) => {
    if (result.kind === "failed") setLoadError(result.failure);
    else setState(result.state);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAllowlist(translate).then((result) => {
      if (!cancelled) applyLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLoad, translate]);

  const retry = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    applyLoad(await loadAllowlist(translate));
  }, [applyLoad, translate]);

  const save = useCallback(
    async (domains: string[]): Promise<boolean> => {
      setSaving(true);
      setSaved(false);
      setSaveError(null);
      setRejected([]);
      const result = await saveAllowlist(translate, domains);
      setSaving(false);
      if (result.kind === "saved") {
        setState(result.state);
        setSaved(true);
        return true;
      }
      setSaveError(result.failure);
      if (result.kind === "rejected") setRejected(result.rejected);
      return false;
    },
    [translate]
  );

  return { state, loading, loadError, saving, saveError, rejected, saved, retry, save };
}
