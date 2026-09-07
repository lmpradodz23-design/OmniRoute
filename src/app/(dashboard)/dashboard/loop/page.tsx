"use client";

import { useCallback, useEffect, useState } from "react";

// Espelha open-sse/loop-engine/types.ts (mantido leve para o cliente).
interface LoopStep {
  id: string;
  runId: string;
  index: number;
  title: string;
  proposedEffect?: { kind: string; summary: string };
  status: "proposed" | "approved" | "rejected" | "verified" | "failed";
}
interface LoopRun {
  id: string;
  pattern: string;
  phase: string;
  status:
    "report_only" | "awaiting_approval" | "verifying" | "done" | "failed" | "escalated" | "aborted";
  budget: { maxTokens: number; maxWallClockMs: number; maxAttempts: number };
  usage: { tokens: number; wallClockMs: number; attempts: number };
  steps: LoopStep[];
  correlationId: string;
  taskId?: string;
  sequenceNumber: number;
}

const STATUS_STYLE: Record<LoopRun["status"], string> = {
  report_only: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  awaiting_approval: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  verifying: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  escalated: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  aborted: "bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-300",
};

function DisabledNotice() {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-600 dark:text-amber-300">
          toggle_off
        </span>
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Loop Engine está desligado.
          </p>
          <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">
            Ative a flag <code className="font-mono">LOOP_ENGINE_ENABLED</code> no painel único para
            usar os ciclos report-only e as aprovações humanas.
          </p>
          <a
            href="/dashboard/settings/feature-flags?q=LOOP_ENGINE_ENABLED"
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white/70 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/20"
          >
            <span className="material-symbols-outlined text-sm">tune</span>
            Abrir Feature Flags
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LoopEnginePage() {
  const [runs, setRuns] = useState<LoopRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyRun, setBusyRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/loop");
      if (res.status === 404) {
        setDisabled(true);
        setRuns([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDisabled(false);
      const data = await res.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startRun = useCallback(async () => {
    const p = pattern.trim();
    if (!p) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: p }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPattern("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao iniciar");
    } finally {
      setStarting(false);
    }
  }, [pattern, load]);

  const advance = useCallback(
    async (id: string) => {
      setBusyRun(id);
      try {
        await fetch(`/api/loop/${id}/advance`, { method: "POST" });
        await load();
      } finally {
        setBusyRun(null);
      }
    },
    [load]
  );

  const decide = useCallback(
    async (id: string, stepId: string, decision: "approve" | "reject") => {
      setBusyRun(id);
      try {
        await fetch(`/api/loop/${id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId, decision }),
        });
        await load();
      } finally {
        setBusyRun(null);
      }
    },
    [load]
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Loop Engine</h1>
        <p className="mt-1 text-sm text-text-muted">
          Ciclos agênticos <strong>report-only</strong>: o Loop propõe, o Policy Engine decide e
          nenhum efeito externo roda sem aprovação humana. Serve ao painel e a qualquer harness via{" "}
          <code className="font-mono">/api/loop</code>.
        </p>
      </div>

      {loading && <div className="h-24 animate-pulse rounded-xl bg-black/[0.04] dark:bg-white/5" />}

      {!loading && disabled && <DisabledNotice />}

      {!loading && !disabled && (
        <>
          {/* Novo run */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-subtle p-4 sm:flex-row sm:items-center">
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void startRun()}
              placeholder="Padrão do ciclo (ex.: pr-babysitter, daily-triage)"
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
            <button
              onClick={() => void startRun()}
              disabled={starting || !pattern.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Iniciando…" : "Iniciar ciclo"}
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          {runs.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              <span className="material-symbols-outlined text-4xl">sync</span>
              <p className="mt-2 text-sm">Nenhum ciclo ainda. Inicie um acima.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => {
                const isOpen = expanded.has(run.id);
                const busy = busyRun === run.id;
                return (
                  <div key={run.id} className="rounded-xl border border-border bg-card">
                    <button
                      onClick={() => toggle(run.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-text-primary">
                            {run.pattern}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[run.status]}`}
                          >
                            {run.status.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs text-text-muted">
                          fase: {run.phase} · tokens {run.usage.tokens}/{run.budget.maxTokens} ·
                          tentativas {run.usage.attempts}/{run.budget.maxAttempts} · {run.id}
                        </p>
                      </div>
                      <span className="material-symbols-outlined shrink-0 text-text-muted">
                        {isOpen ? "expand_less" : "expand_more"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-border px-4 py-3">
                        <div className="mb-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => void advance(run.id)}
                            disabled={busy}
                            className="rounded-lg border border-border bg-bg-subtle px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/5"
                          >
                            {busy ? "…" : "Avançar 1 passo (report-only)"}
                          </button>
                        </div>

                        {run.steps.length === 0 ? (
                          <p className="text-sm text-text-muted">Sem etapas propostas ainda.</p>
                        ) : (
                          <ul className="space-y-2">
                            {run.steps.map((step) => {
                              const canDecide =
                                run.status === "awaiting_approval" && step.status === "proposed";
                              return (
                                <li
                                  key={step.id}
                                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm text-text-primary">
                                      {step.index + 1}. {step.title}
                                    </p>
                                    {step.proposedEffect && step.proposedEffect.kind !== "none" && (
                                      <p className="mt-0.5 text-xs text-text-muted">
                                        efeito proposto:{" "}
                                        <span className="font-mono">
                                          {step.proposedEffect.kind}
                                        </span>{" "}
                                        — {step.proposedEffect.summary}
                                      </p>
                                    )}
                                  </div>
                                  {canDecide ? (
                                    <div className="flex shrink-0 gap-2">
                                      <button
                                        onClick={() => void decide(run.id, step.id, "approve")}
                                        disabled={busy}
                                        className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                      >
                                        Aprovar
                                      </button>
                                      <button
                                        onClick={() => void decide(run.id, step.id, "reject")}
                                        disabled={busy}
                                        className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                                      >
                                        Rejeitar
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="shrink-0 text-xs text-text-muted">
                                      {step.status}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
