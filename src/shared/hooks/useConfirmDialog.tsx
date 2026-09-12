"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ConfirmModal } from "@/shared/components/Modal";
import type { ButtonVariant } from "@/shared/components/Button";

/**
 * Promise-based confirmation backed by the shared ConfirmModal (U5).
 *
 * The dashboard used 35 native `confirm()` calls: browser-styled, not translated
 * ("OK"/"Cancel" come from the browser), unstyled in dark mode, and inert inside
 * Electron when the renderer disables dialogs. `useConfirmDialog()` keeps the call-site
 * shape (`if (!(await confirmDialog(message))) return;`) while rendering the app's modal.
 *
 * Without a provider (a component rendered outside the dashboard tree, unit tests) the
 * hook falls back to the native `confirm` so behaviour degrades, never breaks.
 */

export interface ConfirmDialogOptions {
  title?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  variant?: ButtonVariant;
}

export type ConfirmDialogFn = (
  message: ReactNode,
  options?: ConfirmDialogOptions
) => Promise<boolean>;

interface PendingConfirm extends ConfirmDialogOptions {
  message: ReactNode;
  resolve: (value: boolean) => void;
}

const ConfirmDialogContext = createContext<ConfirmDialogFn | null>(null);

function nativeConfirm(message: ReactNode): Promise<boolean> {
  if (typeof globalThis.confirm !== "function") return Promise.resolve(false);
  return Promise.resolve(
    globalThis.confirm(typeof message === "string" ? message : String(message))
  );
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  const confirm = useCallback<ConfirmDialogFn>(
    (message, options) =>
      new Promise<boolean>((resolve) => {
        // A second request while one is open cancels the first (never two stacked modals).
        pendingRef.current?.resolve(false);
        const next: PendingConfirm = { ...options, message, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    []
  );

  // Unmounting the provider must not leave a handler awaiting forever.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <ConfirmModal
        isOpen={pending !== null}
        onClose={() => settle(false)}
        onConfirm={() => settle(true)}
        title={pending?.title}
        message={pending?.message ?? ""}
        confirmText={pending?.confirmText}
        cancelText={pending?.cancelText}
        variant={pending?.variant ?? "danger"}
      />
    </ConfirmDialogContext.Provider>
  );
}

/** Returns `confirmDialog(message, options?) => Promise<boolean>`. */
export function useConfirmDialog(): ConfirmDialogFn {
  const fromContext = useContext(ConfirmDialogContext);
  return fromContext ?? nativeConfirm;
}
