"use client";

/**
 * Loop Engine page — ConfirmModal shown before a step is approved or rejected. Nothing
 * is sent to `/api/loop/[id]/approve` until the operator confirms here. The wrapper
 * carries the stable data-testid (`loop-approve-confirm` / `loop-reject-confirm`).
 */
import { useTranslations } from "next-intl";

import { ConfirmModal } from "@/shared/components/Modal";

import type { PendingDecision } from "./types";

interface DecisionConfirmModalProps {
  pending: PendingDecision | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DecisionConfirmModal({
  pending,
  busy,
  onClose,
  onConfirm,
}: DecisionConfirmModalProps) {
  const t = useTranslations("loopEngine");
  if (!pending) return null;

  const approve = pending.decision === "approve";
  const values = {
    index: pending.step.index + 1,
    title: pending.step.title,
    kind: pending.step.proposedEffect?.kind ?? "none",
  };
  return (
    <div data-testid={approve ? "loop-approve-confirm" : "loop-reject-confirm"}>
      <ConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title={t(approve ? "approveConfirmTitle" : "rejectConfirmTitle")}
        message={t(approve ? "approveConfirmMessage" : "rejectConfirmMessage", values)}
        confirmText={t(approve ? "approve" : "reject")}
        variant={approve ? "warning" : "danger"}
        loading={busy}
      />
    </div>
  );
}
