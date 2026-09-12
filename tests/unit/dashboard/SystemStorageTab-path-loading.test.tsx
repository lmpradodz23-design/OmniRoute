// @vitest-environment jsdom
// Audit C-07: the System Storage tab seeded its state with a HARDCODED
// `~/.omniroute/storage.sqlite` and painted it until /api/storage/health answered, so
// users briefly saw a database path that was not the real one (custom DATA_DIR,
// %APPDATA% installs...). The path cell must show a loading state until the server
// reports the real path, and only ever render server-provided values.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import SystemStorageTab from "@/app/(dashboard)/dashboard/settings/components/SystemStorageTab";

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

let healthDeferred: Deferred<Response>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  healthDeferred = createDeferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const p = requestPath(input);
      if (p === "/api/storage/health") return healthDeferred.promise;
      // Every other endpoint the tab touches on mount (database settings) is
      // "unavailable" here — the tab tolerates that and renders without them.
      return jsonResponse({ error: "not in this test" }, false);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SystemStorageTab — database path is never guessed (audit C-07)", () => {
  it("shows a loading state, not a hardcoded path, until storage health arrives", async () => {
    const { container } = render(<SystemStorageTab />);
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("Database Path");
    expect(text).not.toContain("~/.omniroute/storage.sqlite");
    expect(text).not.toContain("storage.sqlite");
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("renders the server-reported dbPath once loaded", async () => {
    const { container } = render(<SystemStorageTab />);
    await flush();

    await act(async () => {
      healthDeferred.resolve(
        jsonResponse({
          driver: "sqlite",
          dbPath: "D:\\x\\data\\storage.sqlite",
          dataDir: "D:\\x\\data",
          sizeBytes: 1024,
          lastBackupAt: null,
          backupCount: 0,
          retentionDays: { app: 7, call: 7 },
          tableMaxRows: { callLogs: 100000, proxyLogs: 100000 },
          backupRetention: { maxFiles: 20, days: 0 },
        })
      );
      await healthDeferred.promise;
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("D:\\x\\data\\storage.sqlite");
    expect(text).not.toContain("~/.omniroute");
  });

  it("never falls back to the hardcoded default when the endpoint fails", async () => {
    const { container } = render(<SystemStorageTab />);
    await flush();

    await act(async () => {
      healthDeferred.resolve(jsonResponse({ error: "boom" }, false));
      await healthDeferred.promise;
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).not.toContain("~/.omniroute/storage.sqlite");
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });
});
