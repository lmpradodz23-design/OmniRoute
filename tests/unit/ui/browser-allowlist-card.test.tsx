// @vitest-environment jsdom
/**
 * Settings → Security — Browser Use domain allowlist card: renders the persisted list from
 * GET /api/browser/allowlist (translated copy from the REAL en.json via the global next-intl
 * mock), flags that the list has no effect while BROWSER_USE_ENABLED is off, adds/removes
 * entries and saves the whole list with PUT, confirms "Clear all", and shows readable errors
 * (load failure with retry, 400 invalid_domains naming the rejected entry, network failure)
 * without ever rendering a transport error message.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;
const ENDPOINT = "/api/browser/allowlist";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: FetchHandler) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function putBodies(spy: ReturnType<typeof mockFetch>): unknown[] {
  return spy.mock.calls
    .filter(([input, init]) => String(input) === ENDPOINT && init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

const STATE = {
  allowedDomains: ["example.com", "docs.example.org"],
  enabled: true,
  maxDomains: 256,
};

const { default: BrowserAllowlistCard } =
  await import("../../../src/app/(dashboard)/dashboard/settings/components/browserAllowlist/BrowserAllowlistCard");

function items(): string[] {
  return screen
    .queryAllByTestId("browser-allowlist-item-domain")
    .map((span) => span.textContent ?? "");
}

describe("BrowserAllowlistCard", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows a busy loading state while the list request is in flight", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;
    render(<BrowserAllowlistCard />);
    const loading = screen.getByTestId("browser-allowlist-loading");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.textContent).toContain("Loading the browser allowlist");
  });

  it("renders the persisted list, the count and the enabled badge", async () => {
    mockFetch(() => jsonResponse(STATE));
    render(<BrowserAllowlistCard />);

    await screen.findByTestId("browser-allowlist-list");
    expect(items()).toEqual(["example.com", "docs.example.org"]);
    expect(screen.getByTestId("browser-allowlist-count").textContent).toBe("2 of 256 domains");
    expect(screen.getByTestId("browser-allowlist-flag-badge").textContent).toBe("Browser Use on");
    expect(screen.queryByTestId("browser-allowlist-disabled")).toBeNull();
    expect(screen.getByRole("list", { name: "Allowed domains" })).toBeTruthy();
    expect((screen.getByTestId("browser-allowlist-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the empty state and the flag-off notice when nothing is configured", async () => {
    mockFetch(() => jsonResponse({ allowedDomains: [], enabled: false, maxDomains: 256 }));
    render(<BrowserAllowlistCard />);

    const notice = await screen.findByTestId("browser-allowlist-disabled");
    expect(notice.textContent).toContain("Browser Use is turned off.");
    expect(notice.textContent).toContain("BROWSER_USE_ENABLED");
    expect(within(notice).getByTestId("browser-allowlist-disabled-link").getAttribute("href")).toBe(
      "/dashboard/settings/feature-flags?q=BROWSER_USE_ENABLED"
    );
    expect(screen.getByTestId("browser-allowlist-empty").textContent).toContain(
      "every browser action is denied"
    );
    expect((screen.getByTestId("browser-allowlist-clear") as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("adds a normalized domain, removes one and saves the whole list", async () => {
    const spy = mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { allowedDomains: string[] };
        return jsonResponse({ ...STATE, allowedDomains: body.allowedDomains });
      }
      return jsonResponse(STATE);
    });
    render(<BrowserAllowlistCard />);
    await screen.findByTestId("browser-allowlist-list");

    const input = screen.getByLabelText("Add a domain");
    fireEvent.change(input, { target: { value: "  .API.Example.net " } });
    fireEvent.click(screen.getByTestId("browser-allowlist-add"));
    fireEvent.change(input, { target: { value: "EXAMPLE.com" } });
    expect(screen.getByTestId("browser-allowlist-duplicate").textContent).toBe(
      "example.com is already in the list."
    );
    expect((screen.getByTestId("browser-allowlist-add") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove docs.example.org" }));
    expect(items()).toEqual(["example.com", "api.example.net"]);

    fireEvent.click(screen.getByTestId("browser-allowlist-save"));
    expect((await screen.findByTestId("browser-allowlist-saved")).textContent).toBe(
      "Allowlist saved."
    );
    expect(putBodies(spy)).toEqual([{ allowedDomains: ["example.com", "api.example.net"] }]);
    expect(items()).toEqual(["example.com", "api.example.net"]);
    expect((screen.getByTestId("browser-allowlist-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the rejected entry with a translated reason and keeps the draft", async () => {
    mockFetch((_url, init) =>
      init?.method === "PUT"
        ? jsonResponse(
            {
              error: "One or more domains are invalid",
              code: "invalid_domains",
              invalid: [{ index: 2, reason: "ip_literal" }],
            },
            400
          )
        : jsonResponse(STATE)
    );
    render(<BrowserAllowlistCard />);
    await screen.findByTestId("browser-allowlist-list");

    fireEvent.change(screen.getByLabelText("Add a domain"), { target: { value: "10.0.0.1" } });
    fireEvent.click(screen.getByTestId("browser-allowlist-add"));
    fireEvent.click(screen.getByTestId("browser-allowlist-save"));

    const banner = await screen.findByTestId("browser-allowlist-save-error");
    expect(banner.textContent).toContain(
      "Could not save the browser allowlist. The server rejected the request."
    );
    const rejected = screen.getByTestId("browser-allowlist-rejected");
    expect(rejected.textContent).toContain("10.0.0.1");
    expect(rejected.textContent).toContain("IP addresses are not allowed");
    expect(items()).toEqual(["example.com", "docs.example.org", "10.0.0.1"]);
    expect(screen.queryByTestId("browser-allowlist-saved")).toBeNull();
  });

  it("shows a load error without the transport message and recovers on retry", async () => {
    let attempt = 0;
    mockFetch(() => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("connect ECONNREFUSED 127.0.0.1:20128");
      return jsonResponse(STATE);
    });
    render(<BrowserAllowlistCard />);

    const banner = await screen.findByTestId("browser-allowlist-load-error");
    expect(banner.textContent).toContain("Could not load the browser allowlist.");
    expect(banner.textContent).toContain("could not be reached");
    expect(banner.textContent).not.toContain("ECONNREFUSED");

    fireEvent.click(screen.getByTestId("browser-allowlist-load-error-retry"));
    await screen.findByTestId("browser-allowlist-list");
    expect(screen.queryByTestId("browser-allowlist-load-error")).toBeNull();
  });

  it("asks for confirmation before clearing and sends an empty list only after confirming", async () => {
    const spy = mockFetch((_url, init) =>
      init?.method === "PUT" ? jsonResponse({ ...STATE, allowedDomains: [] }) : jsonResponse(STATE)
    );
    render(<BrowserAllowlistCard />);
    await screen.findByTestId("browser-allowlist-list");

    fireEvent.click(screen.getByTestId("browser-allowlist-clear"));
    const dialog = await screen.findByTestId("browser-allowlist-clear-confirm");
    expect(dialog.textContent).toContain("Clear the whole allowlist?");
    expect(dialog.textContent).toContain("All 2 saved domains will be removed");
    expect(putBodies(spy)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(screen.getByTestId("browser-allowlist-empty")).toBeTruthy());
    expect(putBodies(spy)).toEqual([{ allowedDomains: [] }]);
  });
});
