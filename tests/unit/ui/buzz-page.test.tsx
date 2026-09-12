// @vitest-environment jsdom
/**
 * Buzz Hub page (audit B-M6 / B-L5 / A-M3): translated copy from en.json (the global
 * next-intl mock renders the REAL English catalog), ConfirmModal before "Save relay",
 * readable API errors for both error envelopes (`{ error: string }` and
 * `{ error: { code, message } }`), flag-off notice with a link to the feature-flag
 * grid, and stable data-testids for every interactive state.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;

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

function callsTo(spy: ReturnType<typeof mockFetch>, method: string, path: string) {
  return spy.mock.calls.filter(
    ([input, init]) =>
      String(input) === path && (init?.method ?? "GET").toUpperCase() === method.toUpperCase()
  );
}

const PUBKEY = "ab".repeat(32);
const STATUS = {
  enabled: true,
  relayUrl: "ws://localhost:3000",
  agentPubkey: PUBKEY,
  counts: {
    outboxPending: 3,
    outboxPublished: 12,
    outboxFailed: 1,
    outboxDead: 2,
    inboxReceived: 7,
  },
};

const PORTUGUESE_LEFTOVERS = [
  "URL do relay",
  "Publicar pendentes",
  "Copiar",
  "desligado",
  "Falha",
  "Salvar",
  "Abrir Feature Flags",
];

const { default: BuzzHubPage } = await import("../../../src/app/(dashboard)/dashboard/buzz/page");

async function renderPage() {
  return render(<BuzzHubPage />);
}

describe("BuzzHubPage", () => {
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

  it("shows a busy polite loading state while the status request is in flight", async () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;
    await renderPage();

    const loading = screen.getByTestId("buzz-loading");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.textContent).toContain("Loading Buzz status");
  });

  it("shows the flag-off notice with a link to the flag grid and disables the flush", async () => {
    mockFetch(() => jsonResponse({ ...STATUS, enabled: false }));
    const { container } = await renderPage();

    const notice = await screen.findByTestId("buzz-disabled");
    expect(notice.textContent).toContain("Buzz Hub is turned off.");
    expect(notice.textContent).toContain("BUZZ_HUB_ENABLED");
    expect(within(notice).getByTestId("buzz-disabled-link").getAttribute("href")).toBe(
      "/dashboard/settings/feature-flags?q=BUZZ_HUB_ENABLED"
    );
    expect(screen.getByTestId("buzz-enabled-badge").textContent).toBe("off");
    expect((screen.getByTestId("buzz-flush") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("buzz-flush").getAttribute("title")).toContain("BUZZ_HUB_ENABLED");
    for (const raw of PORTUGUESE_LEFTOVERS) expect(container.textContent).not.toContain(raw);
  });

  it("renders identity, counts and the enabled badge from the status payload", async () => {
    mockFetch(() => jsonResponse(STATUS));
    const { container } = await renderPage();

    expect((await screen.findByTestId("buzz-enabled-badge")).textContent).toBe("enabled");
    expect(screen.getByTestId("buzz-pubkey").textContent).toBe(PUBKEY);
    expect(screen.getByTestId("buzz-count-outbox-pending").textContent).toContain("3");
    expect(screen.getByTestId("buzz-count-outbox-pending").textContent).toContain("Outbox pending");
    expect(screen.getByTestId("buzz-count-outbox-published").textContent).toContain("12");
    expect(screen.getByTestId("buzz-count-outbox-failed").textContent).toContain("1");
    expect(screen.getByTestId("buzz-count-outbox-dead").textContent).toContain("2");
    expect(screen.getByTestId("buzz-count-inbox-received").textContent).toContain("7");
    expect(screen.queryByTestId("buzz-disabled")).toBeNull();
    for (const raw of PORTUGUESE_LEFTOVERS) expect(container.textContent).not.toContain(raw);
  });

  it("asks for confirmation before saving the relay and only then PUTs", async () => {
    const spy = mockFetch((url, init) => {
      if (url === "/api/buzz" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { relayUrl: string };
        return jsonResponse({ ...STATUS, relayUrl: body.relayUrl });
      }
      return jsonResponse(STATUS);
    });
    await renderPage();

    const input = (await screen.findByTestId("buzz-relay-input")) as HTMLInputElement;
    const save = screen.getByTestId("buzz-save-relay") as HTMLButtonElement;
    expect(input.value).toBe("ws://localhost:3000");
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "wss://relay.example.org" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    const confirm = await screen.findByTestId("buzz-save-relay-confirm");
    expect(confirm.textContent).toContain("Change the relay URL?");
    expect(confirm.textContent).toContain("wss://relay.example.org");
    expect(callsTo(spy, "PUT", "/api/buzz")).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole("button", { name: "Save relay" }));
    await waitFor(() => expect(callsTo(spy, "PUT", "/api/buzz")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(spy, "PUT", "/api/buzz")[0][1]?.body))).toEqual({
      relayUrl: "wss://relay.example.org",
    });
    await waitFor(() => expect(screen.queryByTestId("buzz-save-relay-confirm")).toBeNull());
    await waitFor(() =>
      expect((screen.getByTestId("buzz-relay-input") as HTMLInputElement).value).toBe(
        "wss://relay.example.org"
      )
    );
    expect((screen.getByTestId("buzz-save-relay") as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancelling the relay confirmation sends nothing", async () => {
    const spy = mockFetch(() => jsonResponse(STATUS));
    await renderPage();

    fireEvent.change(await screen.findByTestId("buzz-relay-input"), {
      target: { value: "wss://relay.example.org" },
    });
    fireEvent.click(screen.getByTestId("buzz-save-relay"));
    const confirm = await screen.findByTestId("buzz-save-relay-confirm");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("buzz-save-relay-confirm")).toBeNull());
    expect(callsTo(spy, "PUT", "/api/buzz")).toHaveLength(0);
  });

  it.each([
    ["legacy string envelope", { error: "relayUrl must not embed credentials" }],
    [
      "typed envelope",
      { error: { code: "VALIDATION_ERROR", message: "relayUrl must not embed credentials" } },
    ],
  ])("shows a readable rejection for a 400 with a %s", async (_label, body) => {
    mockFetch((url, init) => {
      if (url === "/api/buzz" && init?.method === "PUT") return jsonResponse(body, 400);
      return jsonResponse(STATUS);
    });
    await renderPage();

    fireEvent.change(await screen.findByTestId("buzz-relay-input"), {
      target: { value: "ws://user:pass@10.0.0.5" },
    });
    fireEvent.click(screen.getByTestId("buzz-save-relay"));
    const confirm = await screen.findByTestId("buzz-save-relay-confirm");
    fireEvent.click(within(confirm).getByRole("button", { name: "Save relay" }));

    const error = await screen.findByTestId("buzz-error");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("Could not save the relay URL.");
    expect(error.textContent).toContain("rejected the request");
    expect(within(error).getByTestId("buzz-error-detail").textContent).toContain(
      "must not embed credentials"
    );
    // The rejected draft stays editable so the operator can fix it.
    expect((screen.getByTestId("buzz-relay-input") as HTMLInputElement).value).toBe(
      "ws://user:pass@10.0.0.5"
    );
  });

  it("never shows the raw transport error on load and retries", async () => {
    let failing = true;
    mockFetch(() => {
      if (failing) throw new TypeError("Failed to fetch: ECONNREFUSED 127.0.0.1:20128");
      return jsonResponse(STATUS);
    });
    await renderPage();

    const error = await screen.findByTestId("buzz-error");
    expect(error.textContent).toContain("Could not load the Buzz Hub status.");
    expect(error.textContent).toContain("could not be reached");
    expect(error.textContent).not.toContain("ECONNREFUSED");
    expect(screen.queryByTestId("buzz-relay-card")).toBeNull();
    expect(screen.queryByTestId("buzz-disabled")).toBeNull();

    failing = false;
    fireEvent.click(within(error).getByTestId("buzz-error-retry"));
    await screen.findByTestId("buzz-relay-card");
    expect(screen.queryByTestId("buzz-error")).toBeNull();
  });

  it("reports the flush result and refreshes the counts", async () => {
    let counts = STATUS.counts;
    mockFetch((url, init) => {
      if (url === "/api/buzz/flush" && init?.method === "POST") {
        counts = { ...counts, outboxPending: 0, outboxPublished: 15 };
        return jsonResponse({ published: 3, failed: 0 });
      }
      return jsonResponse({ ...STATUS, counts });
    });
    await renderPage();

    fireEvent.click(await screen.findByTestId("buzz-flush"));
    const message = await screen.findByTestId("buzz-flush-message");
    expect(message.textContent).toBe("Published: 3 · failed: 0");
    await waitFor(() =>
      expect(screen.getByTestId("buzz-count-outbox-published").textContent).toContain("15")
    );
  });

  it("explains a skipped flush when the server reports the flag is off", async () => {
    mockFetch((url, init) => {
      if (url === "/api/buzz/flush" && init?.method === "POST") {
        return jsonResponse({
          published: 0,
          failed: 0,
          skipped: true,
          reason: "BUZZ_HUB_ENABLED is off",
        });
      }
      return jsonResponse(STATUS);
    });
    await renderPage();

    fireEvent.click(await screen.findByTestId("buzz-flush"));
    expect((await screen.findByTestId("buzz-flush-message")).textContent).toContain(
      "BUZZ_HUB_ENABLED flag is off"
    );
  });

  it("reports a flush failure without the raw relay error status line", async () => {
    mockFetch((url, init) => {
      if (url === "/api/buzz/flush" && init?.method === "POST") {
        return jsonResponse({ error: "relay unreachable" }, 502);
      }
      return jsonResponse(STATUS);
    });
    await renderPage();

    fireEvent.click(await screen.findByTestId("buzz-flush"));
    const error = await screen.findByTestId("buzz-error");
    expect(error.textContent).toContain("Could not publish the pending entries.");
    expect(error.textContent).toContain("HTTP 502");
    expect(within(error).getByTestId("buzz-error-detail").textContent).toContain(
      "relay unreachable"
    );
  });

  it("copies the agent pubkey to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mockFetch(() => jsonResponse(STATUS));
    await renderPage();

    fireEvent.click(await screen.findByTestId("buzz-copy-pubkey"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBKEY));
    await waitFor(() =>
      expect(screen.getByTestId("buzz-copy-pubkey").textContent).toContain("Copied")
    );
  });
});
