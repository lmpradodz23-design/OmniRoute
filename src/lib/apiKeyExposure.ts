import { isApiKeyRevealEnabledFlag } from "@/shared/utils/featureFlags";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * `ALLOW_API_KEY_REVEAL` now governs ONLY the reveal of stored third-party PROVIDER
 * credentials on the providers page. OmniRoute's own API keys are never revealable (#7
 * reveal-once): a key is shown in full exactly once — in the create / regenerate responses —
 * and every listing carries only `maskStoredApiKey`'s form.
 */
export function isApiKeyRevealEnabled(): boolean {
  try {
    return isApiKeyRevealEnabledFlag();
  } catch {
    const raw = String(process.env.ALLOW_API_KEY_REVEAL || "")
      .trim()
      .toLowerCase();
    return ENABLED_VALUES.has(raw);
  }
}

export function maskStoredApiKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  return key.slice(0, 8) + "****" + key.slice(-4);
}
