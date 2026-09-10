// @vitest-environment jsdom
/**
 * U2 (audit/04-PRODUCT-GAPS.md): the login page showed "Default password: CHANGEME …" under the
 * password field unconditionally — misleading (and a nudge to try it) once the operator has set
 * a real password. The hint must follow the server's `usingDefaultPassword` flag.
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

const { default: LoginPage } = await import("../../../src/app/login/page");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderWithBootstrap(bootstrap: Record<string, unknown>): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/settings/require-login")) {
        return { ok: true, json: async () => bootstrap } as Response;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    })
  );
  await act(async () => {
    root.render(<LoginPage />);
  });
  for (let attempt = 0; attempt < 20 && !container.textContent?.includes("signIn"); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(container.textContent).toContain("signIn");
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
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

const base = {
  authenticated: false,
  requireLogin: true,
  hasPassword: true,
  setupComplete: true,
  oidcEnabled: false,
  oidcDisablePasswordLogin: false,
};

it("hides the default-password hint once a real password is in place", async () => {
  await renderWithBootstrap({ ...base, usingDefaultPassword: false });
  expect(container.textContent).not.toContain("defaultPasswordHint");
});

it("shows the default-password hint only while CHANGEME is still active", async () => {
  await renderWithBootstrap({ ...base, usingDefaultPassword: true });
  expect(container.textContent).toContain("defaultPasswordHint");
});

it("treats a missing flag (older server) as no hint rather than a misleading one", async () => {
  await renderWithBootstrap(base);
  expect(container.textContent).not.toContain("defaultPasswordHint");
});
