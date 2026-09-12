// @vitest-environment jsdom
/**
 * U3 (audit/04-PRODUCT-GAPS.md): with no password configured, flipping "Require login" used to
 * PATCH `{ requireLogin: true }` immediately — the server then demanded a session nobody could
 * open, and the operator was bounced to /login → onboarding. The tab must instead ask for the
 * password right there and send `{ requireLogin: true, newPassword }` in ONE request.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    (t as unknown as { has: (key: string) => boolean }).has = () => true;
    return t;
  },
}));

vi.mock("@/shared/components", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit";
  }) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({
    label,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
    <label>
      {label}
      <input {...props} />
    </label>
  ),
  Toggle: ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
      type="button"
      data-testid="require-login-toggle"
      aria-pressed={checked}
      onClick={onChange}
    >
      toggle
    </button>
  ),
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("@/shared/constants/providers", () => ({ AI_PROVIDERS: {} }));
vi.mock("@/shared/components/ProviderIcon", () => ({ default: () => null }));
vi.mock("../../../src/app/(dashboard)/dashboard/settings/components/IPFilterSection", () => ({
  default: () => null,
}));
vi.mock("../../../src/app/(dashboard)/dashboard/settings/components/SessionInfoCard", () => ({
  default: () => null,
}));
vi.mock("../../../src/app/(dashboard)/dashboard/settings/components/AuthzSection", () => ({
  default: () => null,
}));

const { default: SecurityTab } =
  await import("../../../src/app/(dashboard)/dashboard/settings/components/SecurityTab");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let patchBodies: unknown[];

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(pred: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function type(placeholder: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`Input not found: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function toggle(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[data-testid="require-login-toggle"]')!;
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  patchBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings" && (!init || !init.method)) {
        return {
          ok: true,
          json: async () => ({ requireLogin: false, hasPassword: false }),
        } as Response;
      }
      if (url === "/api/settings" && init?.method === "PATCH") {
        patchBodies.push(JSON.parse(String(init.body)));
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SecurityTab />);
  });
  await waitFor(() => container.textContent?.includes("requireLogin") ?? false, "settings load");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("asks for a password instead of PATCHing requireLogin alone, then enables login in one request", async () => {
  await act(async () => {
    toggle().click();
  });
  await tick();

  expect(patchBodies, "no request may be sent before a password exists").toEqual([]);
  expect(container.textContent).toContain("requireLoginNeedsPassword");
  expect(container.querySelector("form")).not.toBeNull();
  // no "current password" field — there is none yet
  expect(container.querySelector('input[placeholder="enterCurrentPassword"]')).toBeNull();

  await type("enterNewPassword", "first-password-123");
  await type("confirmPasswordPlaceholder", "first-password-123");
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
  await waitFor(() => patchBodies.length === 1, "single PATCH");

  expect(patchBodies).toEqual([{ requireLogin: true, newPassword: "first-password-123" }]);
  await waitFor(() => toggle().getAttribute("aria-pressed") === "true", "toggle on");
  expect(container.textContent).toContain("passwordUpdated");
  expect(container.textContent).not.toContain("requireLoginNeedsPassword");
});

it("clicking the toggle again while the password is being asked for cancels without a request", async () => {
  await act(async () => {
    toggle().click();
  });
  await tick();
  expect(container.textContent).toContain("requireLoginNeedsPassword");

  await act(async () => {
    toggle().click();
  });
  await tick();
  expect(container.textContent).not.toContain("requireLoginNeedsPassword");
  expect(container.querySelector("form")).toBeNull();
  expect(patchBodies).toEqual([]);
});
