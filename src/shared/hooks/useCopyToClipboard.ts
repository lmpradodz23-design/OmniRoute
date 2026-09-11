"use client";

import { useState, useCallback, useRef } from "react";
import { copyToClipboard } from "@/shared/utils/clipboard";

/**
 * Hook for copy to clipboard with feedback.
 * Uses shared copyToClipboard utility that works on both HTTP and HTTPS.
 *
 * `copied` holds the id of the last successful copy and `failed` the id of the last
 * failed one (U6: a silent failure left the user pasting nothing); both reset after
 * `resetDelay` and each clears the other.
 * @param {number} resetDelay - Time in ms before resetting copied/failed state (default: 2000)
 * @returns {{ copied: string|null, failed: string|null, copy: (text: string, id?: string) => Promise<boolean> }}
 */
export function useCopyToClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string, id = "default"): Promise<boolean> => {
      const success = await copyToClipboard(text);

      if (success) {
        setCopied(id);
        setFailed(null);
      } else {
        setCopied(null);
        setFailed(id);
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setCopied(null);
        setFailed(null);
      }, resetDelay);

      return success;
    },
    [resetDelay]
  );

  return { copied, failed, copy };
}
