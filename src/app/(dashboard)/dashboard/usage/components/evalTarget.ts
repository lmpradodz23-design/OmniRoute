// evalTarget.ts — eval run target helpers for the Evals tab: the target type union
// ("suite-default" | "model" | "combo"), the `<type>:<id>` select-key decoder
// (parseTargetKey) and the localized target label builder (getTargetLabel).
// Extracted verbatim from EvalsTab.tsx (file-size ratchet).

export type EvalTargetType = "suite-default" | "model" | "combo";

export function getTargetLabel(
  target: { type: EvalTargetType; id: string | null },
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (target.type === "combo") {
    return `${t("targetTypeCombo")}: ${target.id || "—"}`;
  }

  if (target.type === "model") {
    return `${t("targetTypeModel")}: ${target.id || "—"}`;
  }

  return t("targetSuiteDefaults");
}

export function parseTargetKey(value: string): { type: EvalTargetType; id: string | null } {
  const [rawType, ...rawId] = value.split(":");
  const idValue = rawId.join(":");

  if (rawType === "combo") {
    return { type: "combo", id: idValue || null };
  }

  if (rawType === "model") {
    return { type: "model", id: idValue || null };
  }

  return { type: "suite-default", id: null };
}
