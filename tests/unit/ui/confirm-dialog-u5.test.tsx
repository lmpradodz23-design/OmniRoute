// U5 (audit/04-PRODUCT-GAPS.md): destructive actions asked for confirmation through the
// browser's native confirm() — untranslated buttons, browser styling, unavailable when a
// host disables dialogs — while the app already had a ConfirmModal. The promise-based
// hook keeps the call sites simple and renders the shared modal; without a provider it
// degrades to the native dialog instead of breaking.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { ConfirmDialogProvider, useConfirmDialog } from "@/shared/hooks/useConfirmDialog";

function Harness({ onResult }: { onResult: (value: boolean) => void }) {
  const confirmDialog = useConfirmDialog();
  return (
    <button
      type="button"
      onClick={async () => {
        onResult(await confirmDialog("Delete the thing?", { confirmText: "Delete it" }));
      }}
    >
      trigger
    </button>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useConfirmDialog (U5)", () => {
  it("renders the shared modal and resolves true when the user confirms", async () => {
    const results: boolean[] = [];
    render(
      <ConfirmDialogProvider>
        <Harness onResult={(value) => results.push(value)} />
      </ConfirmDialogProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText("trigger"));
    });
    expect(screen.getByText("Delete the thing?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Delete it"));
    });
    expect(results).toEqual([true]);
    expect(screen.queryByText("Delete the thing?")).not.toBeInTheDocument();
  });

  it("resolves false on cancel", async () => {
    const results: boolean[] = [];
    render(
      <ConfirmDialogProvider>
        <Harness onResult={(value) => results.push(value)} />
      </ConfirmDialogProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getByText("trigger"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("cancel"));
    });
    expect(results).toEqual([false]);
  });

  it("falls back to the native confirm when no provider is mounted", async () => {
    const native = vi.fn(() => true);
    vi.stubGlobal("confirm", native);
    const results: boolean[] = [];
    render(<Harness onResult={(value) => results.push(value)} />);
    await act(async () => {
      fireEvent.click(screen.getByText("trigger"));
    });
    expect(native).toHaveBeenCalledWith("Delete the thing?");
    expect(results).toEqual([true]);
  });
});
