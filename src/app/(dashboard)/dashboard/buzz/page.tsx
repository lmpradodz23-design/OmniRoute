"use client";

import { useCallback, useEffect, useState } from "react";

interface BuzzCounts {
  outboxPending: number;
  outboxPublished: number;
  outboxFailed: number;
  inboxReceived: number;
}
interface BuzzStatus {
  enabled: boolean;
  relayUrl: string;
  agentPubkey: string;
  counts: BuzzCounts;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle px-4 py-3">
      <p className={`text-2xl font-semibold ${tone ?? "text-text-primary"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  );
}

export default function BuzzHubPage() {
  const [status, setStatus] = useState<BuzzStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relayDraft, setRelayDraft] = useState("");
  const [savingRelay, setSavingRelay] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [flushMsg, setFlushMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Pure fetch (no state writes) so the mount effect only touches state after the
  // response arrives — the base pattern for initial loads.
  const fetchStatus = useCallback(async (): Promise<BuzzStatus> => {
    const res = await fetch("/api/buzz");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as BuzzStatus;
  }, []);

  const applyStatus = useCallback((data: BuzzStatus) => {
    setStatus(data);
    setRelayDraft(data.relayUrl);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyStatus(await fetchStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [applyStatus, fetchStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchStatus();
        if (cancelled) return;
        applyStatus(data);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyStatus, fetchStatus]);

  const saveRelay = useCallback(async () => {
    setSavingRelay(true);
    setError(null);
    try {
      const res = await fetch("/api/buzz", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relayUrl: relayDraft }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as BuzzStatus;
      setStatus(data);
      setRelayDraft(data.relayUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSavingRelay(false);
    }
  }, [relayDraft]);

  const flush = useCallback(async () => {
    setFlushing(true);
    setFlushMsg(null);
    try {
      const res = await fetch("/api/buzz/flush", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.skipped) {
        setFlushMsg(
          data.reason === "BUZZ_HUB_ENABLED is off"
            ? "Flush ignorado: a flag BUZZ_HUB_ENABLED está desligada."
            : "Nada pendente para publicar."
        );
      } else {
        setFlushMsg(`Publicados: ${data.published ?? 0} · falhas: ${data.failed ?? 0}`);
      }
      await load();
    } catch (e) {
      setFlushMsg(e instanceof Error ? e.message : "Falha no flush");
    } finally {
      setFlushing(false);
    }
  }, [load]);

  const copyPubkey = useCallback(() => {
    if (!status) return;
    void navigator.clipboard?.writeText(status.agentPubkey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-text-primary">Buzz Hub</h1>
        {status && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status.enabled
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-300"
            }`}
          >
            {status.enabled ? "ativado" : "desligado"}
          </span>
        )}
      </div>
      <p className="-mt-3 text-sm text-text-muted">
        Colaboração humano+agente sobre um relay <strong>Nostr</strong> auto-hospedado (auth NIP-42,
        outbox/inbox idempotente). A chave Nostr <strong>nunca</strong> autoriza uma ação no
        OmniRoute. Configurado aqui, no painel único.
      </p>

      {loading && <div className="h-24 animate-pulse rounded-xl bg-black/[0.04] dark:bg-white/5" />}

      {!loading && error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => void load()} className="font-medium underline hover:no-underline">
            Tentar de novo
          </button>
        </div>
      )}

      {!loading && status && (
        <>
          {!status.enabled && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <div className="flex items-start gap-3">
                <span
                  className="material-symbols-outlined text-amber-600 dark:text-amber-300"
                  aria-hidden="true"
                >
                  toggle_off
                </span>
                <div>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    Buzz Hub está desligado.
                  </p>
                  <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">
                    A ponte fica durável no DB (outbox/inbox), mas nada conecta ao relay. Ative a
                    flag <code className="font-mono">BUZZ_HUB_ENABLED</code> para publicar.
                  </p>
                  <a
                    href="/dashboard/settings/feature-flags?q=BUZZ_HUB_ENABLED"
                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white/70 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/20"
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">
                      tune
                    </span>
                    Abrir Feature Flags
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Relay URL */}
          <div className="rounded-xl border border-border bg-card p-4">
            <label htmlFor="buzz-relay-url" className="text-sm font-medium text-text-primary">
              URL do relay
            </label>
            <p className="mt-0.5 text-xs text-text-muted">
              Precedência: este valor → env <code className="font-mono">BUZZ_RELAY_URL</code> →
              padrão. Deixe vazio e salve para voltar ao env/padrão.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="buzz-relay-url"
                type="text"
                value={relayDraft}
                onChange={(e) => setRelayDraft(e.target.value)}
                placeholder="ws://localhost:3000"
                className="flex-1 rounded-lg border border-border bg-bg-subtle px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
              />
              <button
                onClick={() => void saveRelay()}
                disabled={savingRelay || relayDraft === status.relayUrl}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingRelay ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>

          {/* Identidade do agente */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-text-primary">Identidade Nostr do agente</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Chave pública estável do OmniRoute no relay (a secreta nunca sai do servidor).
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-subtle px-3 py-2 font-mono text-xs text-text-primary">
                {status.agentPubkey}
              </code>
              <button
                onClick={copyPubkey}
                className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm font-medium text-text-primary hover:bg-black/[0.03] dark:hover:bg-white/5"
              >
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>

          {/* Contagens */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Outbox pendentes"
              value={status.counts.outboxPending}
              tone={
                status.counts.outboxPending > 0 ? "text-amber-600 dark:text-amber-300" : undefined
              }
            />
            <Stat
              label="Publicados"
              value={status.counts.outboxPublished}
              tone="text-emerald-600 dark:text-emerald-300"
            />
            <Stat
              label="Falhas"
              value={status.counts.outboxFailed}
              tone={status.counts.outboxFailed > 0 ? "text-red-600 dark:text-red-300" : undefined}
            />
            <Stat label="Inbox recebidos" value={status.counts.inboxReceived} />
          </div>

          {/* Flush — desabilitado com a flag OFF (paridade com o Loop; nada a publicar sem relay). */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void flush()}
              disabled={flushing || !status.enabled}
              title={!status.enabled ? "Ative BUZZ_HUB_ENABLED para publicar" : undefined}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {flushing ? "Publicando…" : "Publicar pendentes"}
            </button>
            {flushMsg && <span className="text-sm text-text-muted">{flushMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
