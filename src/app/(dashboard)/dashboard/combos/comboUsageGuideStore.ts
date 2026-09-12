// comboUsageGuideStore.ts — external store behind the combos usage guide dismissal.
// Owns the localStorage key, the subscriber set and the subscribe / emit / snapshot
// functions the combos page hands to useSyncExternalStore. Extracted verbatim from
// combos/page.tsx (file-size ratchet); behavior is unchanged.

export const COMBO_USAGE_GUIDE_STORAGE_KEY = "omniroute:combos:hide-usage-guide";

// The dismissal lives in localStorage, which SSR cannot read: a lazy useState
// initializer would render "not dismissed" on the server and the real value on
// the client, and correcting that in an effect is a synchronous setState inside
// an effect (react-hooks/set-state-in-effect) that costs an extra commit of this
// whole tree. useSyncExternalStore is the sanctioned shape for exactly this —
// getServerSnapshot supplies the SSR-safe default, getSnapshot reads the store
// after hydration, and the two handlers below notify subscribers instead of
// setting state. The `storage` listener keeps other tabs in sync for free.
const usageGuideListeners = new Set<() => void>();

export function subscribeUsageGuide(onStoreChange: () => void): () => void {
  usageGuideListeners.add(onStoreChange);
  globalThis.addEventListener?.("storage", onStoreChange);
  return () => {
    usageGuideListeners.delete(onStoreChange);
    globalThis.removeEventListener?.("storage", onStoreChange);
  };
}

export function emitUsageGuideChange(): void {
  for (const listener of usageGuideListeners) listener();
}

export function getUsageGuideSnapshot(): boolean {
  try {
    return globalThis.localStorage?.getItem(COMBO_USAGE_GUIDE_STORAGE_KEY) !== "1";
  } catch {
    // Storage access errors (privacy mode / restricted environments) show the guide.
    return true;
  }
}

export function getUsageGuideServerSnapshot(): boolean {
  return true;
}
