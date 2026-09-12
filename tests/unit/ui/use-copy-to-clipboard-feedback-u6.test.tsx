// U6 (audit/04-PRODUCT-GAPS.md): a failed copy (no clipboard permission, insecure
// context without execCommand) was silent — the button stayed on "Copy" and the user
// pasted nothing. The hook must expose a `failed` state so callers can say so.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/utils/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

import { copyToClipboard } from "@/shared/utils/clipboard";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const copyMock = vi.mocked(copyToClipboard);

afterEach(() => {
  vi.useRealTimers();
  copyMock.mockReset();
});

describe("useCopyToClipboard failure feedback (U6)", () => {
  it("exposes the failed id when the clipboard write fails, and clears it after the delay", async () => {
    vi.useFakeTimers();
    copyMock.mockResolvedValue(false);
    const { result } = renderHook(() => useCopyToClipboard(500));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy("secret-value", "api_key");
    });

    expect(ok).toBe(false);
    expect(result.current.copied).toBeNull();
    expect(result.current.failed).toBe("api_key");

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.failed).toBeNull();
  });

  it("a later successful copy clears a previous failure", async () => {
    copyMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useCopyToClipboard(10_000));

    await act(async () => {
      await result.current.copy("v", "k");
    });
    expect(result.current.failed).toBe("k");

    await act(async () => {
      await result.current.copy("v", "k");
    });
    expect(result.current.failed).toBeNull();
    expect(result.current.copied).toBe("k");
  });
});
