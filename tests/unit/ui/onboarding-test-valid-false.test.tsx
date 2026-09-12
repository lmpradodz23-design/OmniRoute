// @vitest-environment jsdom
/**
 * The provider test route answers HTTP 200 whenever the probe RAN and puts the verdict in the
 * body (`valid: false` + typed `diagnosis`). The first-run wizard treated `testRes.ok` as
 * success, so a dead host produced "connection successful" (observed while fixing C-03 in the
 * final audit). The wizard must read the body and show the typed, readable failure + Retry.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${JSON.stringify(values)})` : key;
    t.has = (key: string) => key.startsWith("apiErrors.");
    return t;
  },
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

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
        // What the route really returns for an unreachable host: HTTP 200, verdict in the body.
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valid: false,
            error: "Could not connect to 10.255.255.1: timed out after 15 s.",
            diagnosis: {
              type: "network_error",
              code: "UPSTREAM_TIMEOUT",
              message: "Could not connect to 10.255.255.1: timed out after 15 s.",
              params: { host: "10.255.255.1", timeoutMs: 15000 },
            },
            latencyMs: 15003,
            statusCode: null,
          }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("a 200 with valid:false is shown as a failure with the typed message and a retry, never as success", async () => {
  await act(async () => {
    root.render(<OnboardingWizard />);
  });
  await waitForText("getStarted");
  await clickButton("getStarted");
  await clickButton("continue");
  await clickButton("skip"); // security
  await clickButton("skip"); // provider
  await waitForText("runTest");

  await clickButton("runTest");
  await waitForText("apiErrors.upstreamTimeout");

  expect(container.textContent).not.toContain("connectionSuccessful");
  expect(container.textContent).toContain("apiErrors.upstreamTimeout");
  expect(container.textContent).toContain("10.255.255.1");
  expect(
    Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "retry")
  ).toBe(true);
});
