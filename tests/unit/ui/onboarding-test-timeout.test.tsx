// @vitest-environment jsdom
/**
 * U8 (audit/04-PRODUCT-GAPS.md): the onboarding "Run test" step had no timeout — a provider
 * that never answered left the wizard on "Testing connection…" forever. The probe must be
 * aborted after 15 s with a message that says so and a Retry.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/shared/hooks", () => ({
  useDisplayBaseUrl: () => "https://api.example.com",
}));
vi.mock(
  "../../../src/app/(dashboard)/dashboard/onboarding/steps/FreeProviderOnboardingCard",
  () => ({
    FreeProviderOnboardingCard: () => null,
  })
);

const { default: OnboardingWizard } =
  await import("../../../src/app/(dashboard)/dashboard/onboarding/page");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let probeCalls: { signal?: AbortSignal | null }[];

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await tick();
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  probeCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings") {
        return { ok: true, json: async () => ({ setupComplete: false }) } as Response;
      }
      if (url === "/api/providers" && !init?.method) {
        return { ok: true, json: async () => ({ connections: [{ id: "c1" }] }) } as Response;
      }
      if (url === "/api/providers/c1/test") {
        probeCalls.push({ signal: init?.signal });
        // A provider that never answers: only the caller's abort can end this request.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("aborts a hanging provider probe after 15 s and offers a retry", async () => {
  await act(async () => {
    root.render(<OnboardingWizard />);
  });
  await waitForText("getStarted");
  await clickButton("getStarted");
  await clickButton("continue");
  await clickButton("skip"); // security
  await clickButton("skip"); // provider
  await waitForText("runTest");

  vi.useFakeTimers();
  await clickButton("runTest");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(container.textContent).toContain("testingConnection");
  expect(probeCalls.length).toBe(1);
  expect(probeCalls[0].signal, "the probe must carry an abort signal").toBeTruthy();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(14_000);
  });
  expect(container.textContent, "still waiting before the deadline").toContain("testingConnection");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_100);
  });
  expect(probeCalls[0].signal?.aborted).toBe(true);
  expect(container.textContent).toContain("testTimedOut");
  expect(container.textContent).not.toContain("testingConnection");
  expect(
    Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "retry")
  ).toBe(true);
});
