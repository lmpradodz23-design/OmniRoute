// @vitest-environment jsdom
/**
 * U1 (audit/04-PRODUCT-GAPS.md): the onboarding wizard captured API failures into
 * `errorMessage` but never rendered it — a non-technical user clicking "Set password" or
 * "Add provider" against a failing server saw nothing happen. The message must be visible,
 * announced (`role="alert"`) and cleared when the user moves to another step.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
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

type Route = { ok: boolean; body: unknown };
let routes: Record<string, Route>;

function response(route: Route): Response {
  return { ok: route.ok, json: async () => route.body } as Response;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

async function clickButton(label: string): Promise<void> {
  await act(async () => {
    findButton(label).click();
  });
  await tick();
}

async function typeInto(placeholder: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`Input not found: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function alerts(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]'));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  pushMock.mockReset();
  replaceMock.mockReset();
  routes = {
    "/api/settings": { ok: true, body: { setupComplete: false } },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = routes[String(input)];
      if (!route) throw new Error(`Unexpected request: ${String(input)}`);
      return response(route);
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

async function goToSecurityStep(): Promise<void> {
  await act(async () => {
    root.render(<OnboardingWizard />);
  });
  await waitForText("getStarted");
  await clickButton("getStarted");
  await clickButton("continue");
  await waitForText("securityDesc");
}

it("shows the server's error when setting the password fails, as an alert", async () => {
  routes["/api/settings/require-login"] = {
    ok: false,
    body: { error: "Password must be at least 8 characters" },
  };
  await goToSecurityStep();
  await typeInto("enterPassword", "short");
  await typeInto("confirmPasswordPlaceholder", "short");
  await clickButton("setPassword");

  await waitForText("Password must be at least 8 characters");
  const [alert] = alerts();
  expect(alert, "the error must be announced via role=alert").toBeDefined();
  expect(alert.textContent).toContain("Password must be at least 8 characters");
  // still on the security step — nothing silently advanced
  expect(container.textContent).toContain("securityDesc");
});

it("falls back to the translated message when the failure carries no body", async () => {
  routes["/api/settings/require-login"] = { ok: false, body: {} };
  await goToSecurityStep();
  await typeInto("enterPassword", "hunter22");
  await typeInto("confirmPasswordPlaceholder", "hunter22");
  await clickButton("setPassword");

  await waitForText("failedSetPassword");
  expect(alerts().map((a) => a.textContent)).toContain("failedSetPassword");
});

it("shows the provider error and clears it when the user leaves the step", async () => {
  routes["/api/settings/require-login"] = { ok: true, body: { ok: true } };
  routes["/api/auth/login"] = { ok: true, body: { ok: true } };
  routes["/api/providers"] = { ok: false, body: { error: "Invalid API key" } };
  await goToSecurityStep();
  await typeInto("enterPassword", "hunter22");
  await typeInto("confirmPasswordPlaceholder", "hunter22");
  await clickButton("setPassword");
  await waitForText("providerDesc");

  await clickButton("OpenAI");
  await typeInto("apiKeyRequired", "sk-test-not-a-real-key");
  await clickButton("addProvider");

  await waitForText("Invalid API key");
  expect(alerts().length).toBe(1);

  // Moving on (skip) must not carry a stale error into the next step.
  await clickButton("skip");
  await waitForText("testDesc");
  expect(alerts().length).toBe(0);
});
