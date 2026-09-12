// @vitest-environment jsdom
/**
 * Loop Engine page (audit A-M4 / B-L5 / A-M3): translated copy from en.json (the global
 * next-intl mock renders the REAL English catalog, so a missing key would surface as its
 * raw key), ConfirmModal before approve/reject, readable API errors (409 conflict and
 * network failure — never `err.message` of a transport error), flag-off notice with a
 * link to the feature-flag grid, and stable data-testids for every interactive state.
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

const RUN = {
  id: "run-1",
  pattern: "pr-babysitter",
  phase: "propose",
  status: "awaiting_approval",
  budget: { maxTokens: 1000, maxWallClockMs: 60_000, maxAttempts: 3 },
  usage: { tokens: 10, wallClockMs: 5, attempts: 1 },
  steps: [
    {
      id: "step-1",
      runId: "run-1",
      index: 0,
      title: "Open the pull request",
      proposedEffect: { kind: "write", summary: "push the branch" },
      status: "proposed",
    },
  ],
  correlationId: "corr-1",
  sequenceNumber: 4,
};

const PORTUGUESE_LEFTOVERS = [
  "Iniciar ciclo",
  "Aprovar",
  "Rejeitar",
  "desligado",
  "Nenhum ciclo",
  "Falha ao",
  "Abrir Feature Flags",
];

const { default: LoopEnginePage } =
  await import("../../../src/app/(dashboard)/dashboard/loop/page");

async function renderPage() {
  return render(<LoopEnginePage />);
}

async function openRun(id: string) {
  const toggle = await screen.findByTestId(`loop-run-toggle-${id}`);
  fireEvent.click(toggle);
}

describe("LoopEnginePage", () => {
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

  it("shows a busy polite loading state while the first request is in flight", async () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;
    await renderPage();

    const loading = screen.getByTestId("loop-loading");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.textContent).toContain("Loading cycles");
  });

  it("explains how to turn the flag on when the API answers 404 (flag off)", async () => {
    mockFetch(() => jsonResponse({ error: { message: "Loop Engine is disabled." } }, 404));
    const { container } = await renderPage();

    const notice = await screen.findByTestId("loop-disabled");
    expect(notice.textContent).toContain("Loop Engine is turned off.");
    expect(notice.textContent).toContain("LOOP_ENGINE_ENABLED");
    const link = within(notice).getByTestId("loop-disabled-link");
    expect(link.getAttribute("href")).toBe(
      "/dashboard/settings/feature-flags?q=LOOP_ENGINE_ENABLED"
    );
    expect(link.textContent).toContain("Open Feature Flags");
    expect(screen.queryByTestId("loop-start-button")).toBeNull();
    for (const raw of PORTUGUESE_LEFTOVERS) expect(container.textContent).not.toContain(raw);
  });

  it("renders the empty state and starts a cycle from the form", async () => {
    let runs: unknown[] = [];
    const spy = mockFetch((url, init) => {
      if (url === "/api/loop" && init?.method === "POST") {
        runs = [RUN];
        return jsonResponse({ run: RUN }, 201);
      }
      return jsonResponse({ runs });
    });
    const { container } = await renderPage();

    const empty = await screen.findByTestId("loop-empty");
    expect(empty.textContent).toContain("No cycles yet.");

    const start = screen.getByTestId("loop-start-button") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("loop-pattern-input"), {
      target: { value: "pr-babysitter" },
    });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);

    await waitFor(() => expect(callsTo(spy, "POST", "/api/loop")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(spy, "POST", "/api/loop")[0][1]?.body))).toEqual({
      pattern: "pr-babysitter",
    });
    await screen.findByTestId("loop-run-toggle-run-1");
    expect(screen.queryByTestId("loop-empty")).toBeNull();
    for (const raw of PORTUGUESE_LEFTOVERS) expect(container.textContent).not.toContain(raw);
  });

  it("asks for confirmation before approving and only then calls the API", async () => {
    const spy = mockFetch((url, init) => {
      if (url === "/api/loop/run-1/approve" && init?.method === "POST") {
        return jsonResponse({ run: { ...RUN, status: "verifying" }, decision: "approve" });
      }
      return jsonResponse({ runs: [RUN] });
    });
    await renderPage();
    await openRun("run-1");

    fireEvent.click(screen.getByTestId("loop-approve-step-1"));
    const confirm = await screen.findByTestId("loop-approve-confirm");
    expect(confirm.textContent).toContain("Approve this step?");
    expect(confirm.textContent).toContain("Open the pull request");
    expect(callsTo(spy, "POST", "/api/loop/run-1/approve")).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(callsTo(spy, "POST", "/api/loop/run-1/approve")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(spy, "POST", "/api/loop/run-1/approve")[0][1]?.body))).toEqual(
      {
        stepId: "step-1",
        decision: "approve",
      }
    );
    await waitFor(() => expect(screen.queryByTestId("loop-approve-confirm")).toBeNull());
  });

  it("asks for confirmation before rejecting and cancelling sends nothing", async () => {
    const spy = mockFetch((url, init) => {
      if (url === "/api/loop/run-1/approve" && init?.method === "POST") {
        return jsonResponse({ run: RUN, decision: "reject" });
      }
      return jsonResponse({ runs: [RUN] });
    });
    await renderPage();
    await openRun("run-1");

    fireEvent.click(screen.getByTestId("loop-reject-step-1"));
    const confirm = await screen.findByTestId("loop-reject-confirm");
    expect(confirm.textContent).toContain("Reject this step?");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("loop-reject-confirm")).toBeNull());
    expect(callsTo(spy, "POST", "/api/loop/run-1/approve")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("loop-reject-step-1"));
    const reopened = await screen.findByTestId("loop-reject-confirm");
    fireEvent.click(within(reopened).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(callsTo(spy, "POST", "/api/loop/run-1/approve")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(spy, "POST", "/api/loop/run-1/approve")[0][1]?.body))).toEqual(
      {
        stepId: "step-1",
        decision: "reject",
      }
    );
  });

  it("renders a 409 conflict on advance as a readable message (typed error envelope)", async () => {
    const spy = mockFetch((url, init) => {
      if (url === "/api/loop/run-1/advance" && init?.method === "POST") {
        return jsonResponse(
          { error: { message: "run changed: expected sequence 4, found 5", type: "conflict" } },
          409
        );
      }
      return jsonResponse({ runs: [RUN] });
    });
    await renderPage();
    await openRun("run-1");

    fireEvent.click(screen.getByTestId("loop-advance-run-1"));
    const error = await screen.findByTestId("loop-error");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("Could not advance the cycle.");
    expect(error.textContent).toContain("changed in the meantime");
    expect(within(error).getByTestId("loop-error-detail").textContent).toContain(
      "expected sequence 4, found 5"
    );
    expect(error.textContent).not.toContain("HTTP 409");

    const body = JSON.parse(String(callsTo(spy, "POST", "/api/loop/run-1/advance")[0][1]?.body));
    expect(body).toEqual({ expectedSequenceNumber: 4 });
  });

  it("renders a legacy `{ error: string }` 400 body as a readable rejection", async () => {
    mockFetch((url, init) => {
      if (url === "/api/loop" && init?.method === "POST") {
        return jsonResponse({ error: "pattern must match [A-Za-z0-9._-]" }, 400);
      }
      return jsonResponse({ runs: [] });
    });
    await renderPage();
    await screen.findByTestId("loop-empty");

    fireEvent.change(screen.getByTestId("loop-pattern-input"), { target: { value: "bad name" } });
    fireEvent.click(screen.getByTestId("loop-start-button"));

    const error = await screen.findByTestId("loop-error");
    expect(error.textContent).toContain("Could not start the cycle.");
    expect(error.textContent).toContain("rejected the request");
    expect(within(error).getByTestId("loop-error-detail").textContent).toContain(
      "pattern must match"
    );
  });

  it("never shows the raw transport error and offers a retry that reloads", async () => {
    let failing = true;
    mockFetch(() => {
      if (failing) throw new TypeError("Failed to fetch: ECONNREFUSED 127.0.0.1:20128");
      return jsonResponse({ runs: [RUN] });
    });
    await renderPage();

    const error = await screen.findByTestId("loop-error");
    expect(error.textContent).toContain("Could not load the Loop Engine cycles.");
    expect(error.textContent).toContain("could not be reached");
    expect(error.textContent).not.toContain("ECONNREFUSED");
    expect(error.textContent).not.toContain("Failed to fetch");

    failing = false;
    fireEvent.click(within(error).getByTestId("loop-error-retry"));
    await screen.findByTestId("loop-run-toggle-run-1");
    expect(screen.queryByTestId("loop-error")).toBeNull();
  });

  it("translates run/step statuses and marks the busy advance button", async () => {
    mockFetch((url, init) => {
      if (url === "/api/loop/run-1/advance" && init?.method === "POST") {
        return new Promise(() => {});
      }
      return jsonResponse({ runs: [RUN] });
    });
    const { container } = await renderPage();
    await openRun("run-1");

    expect(screen.getByTestId("loop-run-status-run-1").textContent).toBe("awaiting approval");
    expect(screen.getByTestId("loop-step-step-1").textContent).toContain(
      "1. Open the pull request"
    );
    expect(screen.getByTestId("loop-step-step-1").textContent).toContain("push the branch");

    const advance = screen.getByTestId("loop-advance-run-1") as HTMLButtonElement;
    fireEvent.click(advance);
    await waitFor(() => expect(advance.disabled).toBe(true));
    expect((screen.getByTestId("loop-approve-step-1") as HTMLButtonElement).disabled).toBe(true);
    for (const raw of PORTUGUESE_LEFTOVERS) expect(container.textContent).not.toContain(raw);
  });
});
