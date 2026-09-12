// @vitest-environment jsdom
// Audit C-07: the zero-config banner used to GUESS the `server.env` location from the
// browser's `navigator.platform` (`%APPDATA%\omniroute\server.env` on a Windows client,
// `~/.omniroute/server.env` elsewhere) — a path that was simply wrong whenever the server
// ran with a custom DATA_DIR (or on a different OS than the browser). It also forgot its
// dismissal on every reload. The banner must show the REAL path reported by the server,
// render a loading state (never a guessed path) until that arrives, and remember dismissal.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import BootstrapBanner from "@/app/(dashboard)/dashboard/BootstrapBanner";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data } as Response;
}

function requestPath(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
}

const HEALTH_PATH = "/api/storage/health";

let healthDeferred: Deferred<Response>;
let healthCalls: number;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  healthDeferred = createDeferred<Response>();
  healthCalls = 0;
  // A Windows BROWSER talking to a server with a custom DATA_DIR — the exact scenario in
  // which the old `navigator.platform` guess produced `%APPDATA%\omniroute\server.env`.
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(input) === HEALTH_PATH) {
        healthCalls += 1;
        return healthDeferred.promise;
      }
      throw new Error(`unexpected fetch: ${requestPath(input)}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BootstrapBanner — server-reported server.env path (audit C-07)", () => {
  it("renders NO path (loading state) before /api/storage/health responds", async () => {
    const { container } = render(<BootstrapBanner />);
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("Running in zero-config mode");
    expect(healthCalls).toBe(1);
    // Nothing guessed from the browser platform, nothing from a hardcoded default.
    expect(text).not.toContain("%APPDATA%");
    expect(text).not.toContain(".omniroute");
    expect(text).not.toContain("server.env");
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("shows <dataDir>\\server.env from the server, never the navigator.platform guess", async () => {
    const { container } = render(<BootstrapBanner />);
    await flush();

    await act(async () => {
      healthDeferred.resolve(jsonResponse({ driver: "sqlite", dataDir: "D:\\x\\data" }));
      await healthDeferred.promise;
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("D:\\x\\data\\server.env");
    expect(text).not.toContain("%APPDATA%");
    expect(text).not.toContain(".omniroute");
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("prefers the server's explicit serverEnvPath when present", async () => {
    const { container } = render(<BootstrapBanner />);
    await flush();

    await act(async () => {
      healthDeferred.resolve(
        jsonResponse({
          driver: "sqlite",
          dataDir: "~/some/abbreviated/dir",
          serverEnvPath: "/srv/omniroute/data/server.env",
        })
      );
      await healthDeferred.promise;
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("/srv/omniroute/data/server.env");
    expect(text).not.toContain("~/some/abbreviated/dir");
  });

  it("joins POSIX data dirs with a forward slash", async () => {
    const { container } = render(<BootstrapBanner />);
    await flush();

    await act(async () => {
      healthDeferred.resolve(jsonResponse({ driver: "sqlite", dataDir: "/var/lib/omniroute" }));
      await healthDeferred.promise;
    });
    await flush();

    expect(container.textContent ?? "").toContain("/var/lib/omniroute/server.env");
  });

  it("falls back to a path-free message when the health endpoint fails — still no guess", async () => {
    const { container } = render(<BootstrapBanner />);
    await flush();

    await act(async () => {
      healthDeferred.resolve(jsonResponse({ error: "boom" }, false));
      await healthDeferred.promise;
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("Running in zero-config mode");
    expect(text).toContain("server.env");
    expect(text).not.toContain("%APPDATA%");
    expect(text).not.toContain(".omniroute");
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });
});

describe("BootstrapBanner — dismissal persists across reloads (audit C-07)", () => {
  it("stays dismissed after unmount + remount (simulated reload)", async () => {
    const first = render(<BootstrapBanner />);
    await flush();
    expect(first.container.textContent).toContain("Running in zero-config mode");

    fireEvent.click(first.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(first.container.textContent).not.toContain("Running in zero-config mode");
    first.unmount();

    // "Reload": a fresh component tree reading the persisted preference.
    const second = render(<BootstrapBanner />);
    await flush();
    expect(second.container.textContent).not.toContain("Running in zero-config mode");
    expect(second.container.querySelector("[role='alert']")).toBeNull();
  });

  it("is shown again when nothing was persisted", async () => {
    const { container } = render(<BootstrapBanner />);
    await flush();
    expect(container.querySelector("[role='alert']")).not.toBeNull();
  });
});
