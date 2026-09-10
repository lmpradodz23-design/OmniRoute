// @vitest-environment jsdom
/**
 * U4 (audit/04-PRODUCT-GAPS.md): the Security tab surfaced API failures either as the raw
 * technical sentence ("currentPassword required for security-impacting setting changes") or —
 * for the `{ error: { code, message } }` shape returned by PATCH /api/settings — as an object
 * handed straight to React. The user must get a translated message keyed by the error code,
 * with the technical text tucked behind "details", and a toggle failure must not be silent.
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
let patchResponse: { ok: boolean; status: number; body: unknown };
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

function button(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label
  );
  if (!el) throw new Error(`Button not found: ${label}`);
  return el;
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

async function render(settings: Record<string, unknown>): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings" && (!init || !init.method)) {
        return { ok: true, json: async () => settings } as Response;
      }
      if (url === "/api/settings" && init?.method === "PATCH") {
        patchBodies.push(JSON.parse(String(init.body)));
        return {
          ok: patchResponse.ok,
          status: patchResponse.status,
          json: async () => patchResponse.body,
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  await act(async () => {
    root.render(<SecurityTab />);
  });
  await waitFor(() => container.textContent?.includes("requireLogin") ?? false, "settings load");
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  patchBodies = [];
  patchResponse = { ok: true, status: 200, body: { success: true } };
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

it("translates a coded PATCH failure and keeps the technical sentence behind details", async () => {
  patchResponse = {
    ok: false,
    status: 401,
    body: { error: { code: "PASSWORD_MISMATCH", message: "Invalid current password" } },
  };
  await render({ requireLogin: true, hasPassword: true });

  // Turning the toggle off with a password set opens the confirm modal.
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="require-login-toggle"]')!.click();
  });
  await waitFor(() => Boolean(container.querySelector('[data-testid="modal"]')), "modal");
  await type("currentPassword", "wrong");
  await act(async () => {
    button("confirm").click();
  });
  await waitFor(
    () => container.textContent?.includes("apiErrors.passwordMismatch") ?? false,
    "translated error"
  );
  const details = container.querySelector("details");
  expect(details, "technical detail is available behind a details element").not.toBeNull();
  expect(details!.textContent).toContain("Invalid current password");
  // the raw sentence is not the headline
  const alert = container.querySelector('[role="alert"]');
  expect(alert!.textContent).toContain("apiErrors.passwordMismatch");
});

it("never hands an error object to React when changing the password fails", async () => {
  patchResponse = {
    ok: false,
    status: 400,
    body: {
      error: {
        code: "PASSWORD_REQUIRED",
        message: "currentPassword required for security-impacting setting changes",
      },
    },
  };
  await render({ requireLogin: true, hasPassword: true });
  await type("enterCurrentPassword", "old-pass");
  await type("enterNewPassword", "new-pass-123");
  await type("confirmPasswordPlaceholder", "new-pass-123");
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
  await waitFor(
    () => container.textContent?.includes("apiErrors.passwordRequired") ?? false,
    "translated password error"
  );
  expect(container.textContent).not.toContain("[object Object]");
});

it("a failed requireLogin toggle without a password is reported, not swallowed", async () => {
  patchResponse = { ok: false, status: 500, body: { error: "Database is locked" } };
  await render({ requireLogin: false, hasPassword: false });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="require-login-toggle"]')!.click();
  });
  await waitFor(
    () => container.textContent?.includes("Database is locked") ?? false,
    "toggle error"
  );
  expect(patchBodies).toEqual([{ requireLogin: true }]);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
