"use client";

/**
 * Buzz Hub page — the agent's stable Nostr public key with a copy action (the secret
 * key never reaches the client; `/api/buzz` only ever returns `agentPubkey`).
 */
import { useTranslations } from "next-intl";

import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

interface IdentityCardProps {
  /** null while the identity has not been created (hub never enabled yet). */
  pubkey: string | null;
}

export function IdentityCard({ pubkey }: IdentityCardProps) {
  const t = useTranslations("buzzHub");
  const tCommon = useTranslations("common");
  const { copied, copy } = useCopyToClipboard(1500);

  return (
    <div data-testid="buzz-identity-card" className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-text-primary">{t("identityTitle")}</p>
      <p className="mt-0.5 text-xs text-text-muted">{t("identityHint")}</p>
      <div className="mt-2 flex items-center gap-2">
        <code
          data-testid="buzz-pubkey"
          className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-subtle px-3 py-2 font-mono text-xs text-text-primary"
        >
          {pubkey ?? t("identityPending")}
        </code>
        <button
          type="button"
          data-testid="buzz-copy-pubkey"
          disabled={!pubkey}
          onClick={() => pubkey && void copy(pubkey, "pubkey")}
          className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm font-medium text-text-primary hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
        >
          {copied === "pubkey" ? tCommon("copied") : tCommon("copy")}
        </button>
      </div>
    </div>
  );
}
