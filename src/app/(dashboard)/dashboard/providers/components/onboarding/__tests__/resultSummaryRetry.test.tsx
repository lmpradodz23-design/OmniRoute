// @vitest-environment jsdom
//
// Final audit C-03: the provider wizard's result card rendered a failed connection test
// as the unreadable "Endpoint <path>" with the wrong cause and no way to retry. It must
// now (1) render the typed transport failure as a translated sentence with the dialed
// host and timeout, (2) hide the synthetic HTTP badge for such failures, and (3) offer a
// "Retry test" button that re-runs the test in place (parent callback) — disabled while
// the retry is running, and with the card in its neutral (non-error) state meanwhile.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultSummary } from "../ProviderOnboardingWizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

type Translator = ((key: string, values?: Record<string, unknown>) => string) & {
  has?: (key: string) => boolean;
};

const PROVIDER_MESSAGES: Record<string, string> = {
  onboardingTestFailed: "Test failed",
  onboardingRetryTest: "Retry test",
  onboardingProviderSavedWithWarnings: "Provider saved with warnings",
  onboardingProviderFinished: "Provider onboarding finished",
  backToProviders: "Back to providers",
  onboardingTryInPlayground: "Try in playground",
};

const COMMON_MESSAGES: Record<string, string> = {
  "apiErrors.upstreamTimeout":
    "Could not connect to {host}: timed out after {seconds} s. Check the URL and that the service is running.",
  "apiErrors.upstreamUnreachable":
    "Could not connect to {host}. Check the URL and that the service is running.",
  "apiErrors.unknownHost": "the provider",
};

function makeTranslator(messages: Record<string, string>): Translator {
  const t = ((key: string, values?: Record<string, unknown>) => {
    const template = messages[key] ?? key;
    return Object.entries(values ?? {}).reduce(
      (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
      template
    );
  }) as Translator;
  t.has = (key: string) => Object.prototype.hasOwnProperty.call(messages, key);
  return t;
}

const t = makeTranslator(PROVIDER_MESSAGES);
const tc = makeTranslator(COMMON_MESSAGES);
const connection = { id: "conn-1", provider: "openai-compatible", name: "My LLM" };

const TIMEOUT_RESULT = {
  valid: false,
  error:
    "Could not connect to 10.255.255.1: timed out after 15 s. Check the URL and that the service is running.",
  warning: null,
  statusCode: 504,
  latencyMs: 16226,
  diagnosis: {
    type: "network_error",
    source: "upstream",
    code: "UPSTREAM_TIMEOUT",
    message:
      "Could not connect to 10.255.255.1: timed out after 15 s. Check the URL and that the service is running.",
    params: { host: "10.255.255.1", timeoutMs: 15000 },
  },
};

const cleanups: Array<() => void> = [];

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function retryButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-testid="connection-test-retry"]');
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("ProviderOnboardingWizard ResultSummary (C-03)", () => {
  it("renders a typed transport failure as a translated sentence with host + seconds and no HTTP badge", () => {
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={TIMEOUT_RESULT}
        error={null}
        t={t}
        tc={tc}
        onRetry={() => {}}
      />
    );
    const message = container.querySelector('[data-testid="connection-test-failure-message"]');
    expect(message?.textContent).toBe(
      "Could not connect to 10.255.255.1: timed out after 15 s. Check the URL and that the service is running."
    );
    expect(container.textContent).not.toContain("<path>");
    expect(container.textContent).not.toContain("HTTP 504");
    expect(container.textContent).toContain("Test failed");
  });

  it("shows a Retry button on failure and re-runs the test through the parent callback", () => {
    const onRetry = vi.fn();
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={TIMEOUT_RESULT}
        error={null}
        t={t}
        tc={tc}
        onRetry={onRetry}
      />
    );
    const button = retryButton(container);
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Retry test");
    expect(button?.disabled).toBe(false);

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables Retry while a retry is running", () => {
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={TIMEOUT_RESULT}
        error={null}
        t={t}
        tc={tc}
        onRetry={() => {}}
        retrying
      />
    );
    expect(retryButton(container)?.disabled).toBe(true);
  });

  it("uses the neutral (non-error) styling while the retry is in flight (no result yet)", () => {
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={null}
        error={null}
        t={t}
        tc={tc}
        onRetry={() => {}}
        retrying
      />
    );
    const iconWrapper = container.querySelector(".size-12");
    expect(iconWrapper?.className).toContain("bg-primary/10");
    expect(iconWrapper?.className).not.toContain("bg-error/10");
    expect(container.textContent).toContain("Provider onboarding finished");
  });

  it("falls back to the host-less sentence when the diagnosis carries no host", () => {
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={{
          valid: false,
          error:
            "Could not connect to the provider. Check the URL and that the service is running.",
          statusCode: null,
          diagnosis: { type: "network_error", code: "UPSTREAM_UNREACHABLE", message: null },
        }}
        error={null}
        t={t}
        tc={tc}
        onRetry={() => {}}
      />
    );
    const message = container.querySelector('[data-testid="connection-test-failure-message"]');
    expect(message?.textContent).toBe(
      "Could not connect to the provider. Check the URL and that the service is running."
    );
  });

  it("keeps legacy failures readable (server sentence + HTTP badge) and still offers Retry", () => {
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={{
          valid: false,
          error: "Invalid API key",
          statusCode: 401,
          diagnosis: { type: "upstream_auth_error", code: "401", message: "Invalid API key" },
        }}
        error={null}
        t={t}
        tc={tc}
        onRetry={() => {}}
      />
    );
    expect(container.textContent).toContain("Invalid API key");
    expect(container.textContent).toContain("HTTP 401");
    expect(retryButton(container)).not.toBeNull();
  });

  it("offers no Retry button when the test passed", () => {
    const container = render(
      <ResultSummary
        connection={connection}
        testResult={{ valid: true, error: null, latencyMs: 120 }}
        error={null}
        t={t}
        tc={tc}
        onRetry={() => {}}
      />
    );
    expect(retryButton(container)).toBeNull();
  });
});
