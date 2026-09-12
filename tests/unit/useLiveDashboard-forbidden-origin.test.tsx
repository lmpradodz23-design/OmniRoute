// @vitest-environment jsdom
//
// Final audit C-01: the live dashboard client kept reconnecting forever after
// the server refused its Origin (`FORBIDDEN_ORIGIN` + close code 4003) - 345
// console errors in 40 minutes on a second instance. A refused Origin is a
// policy decision, not a transient network fault: retrying can never succeed
// until the server (or its configuration) changes, so the client must stop and
// surface an "unavailable" state instead of looping.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_WS_CLOSE_FORBIDDEN_ORIGIN,
  shouldReconnectAfterClose,
  useLiveDashboard,
  type DashboardConnectionState,
} from "../../src/hooks/useLiveDashboard";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.serverClose(1000, "");
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  serverMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  serverClose(code: number, reason: string): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const cleanupCallbacks: Array<() => void> = [];

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  cleanupCallbacks.push(() => container.remove());
  return container;
}

function mountHook(): { latest: () => DashboardConnectionState } {
  const container = makeContainer();
  const root = createRoot(container);
  let latest: DashboardConnectionState | null = null;

  function C() {
    const { connection } = useLiveDashboard({
      wsUrl: "ws://127.0.0.1:20132/live-ws",
      channels: ["requests"],
    });
    latest = connection;
    return null;
  }

  act(() => {
    root.render(<C />);
  });
  cleanupCallbacks.push(() => {
    act(() => {
      root.unmount();
    });
  });
  return {
    latest: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
  };
}

describe("shouldReconnectAfterClose (pure reconnect decision)", () => {
  it("reconnects after an ordinary close when autoReconnect is on", () => {
    expect(shouldReconnectAfterClose({ autoReconnect: true, closeCode: 1006 })).toBe(true);
    expect(shouldReconnectAfterClose({ autoReconnect: true, closeCode: 1000 })).toBe(true);
  });

  it("never reconnects when autoReconnect is off", () => {
    expect(shouldReconnectAfterClose({ autoReconnect: false, closeCode: 1006 })).toBe(false);
  });

  it("stops after the server refused the Origin (close code 4003)", () => {
    expect(
      shouldReconnectAfterClose({ autoReconnect: true, closeCode: LIVE_WS_CLOSE_FORBIDDEN_ORIGIN })
    ).toBe(false);
  });

  it("stops when the server sent a FORBIDDEN_ORIGIN error frame, whatever the close code", () => {
    expect(
      shouldReconnectAfterClose({
        autoReconnect: true,
        closeCode: 1005,
        lastServerErrorCode: "FORBIDDEN_ORIGIN",
      })
    ).toBe(false);
  });
});

describe("useLiveDashboard after FORBIDDEN_ORIGIN (final audit C-01)", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (cleanupCallbacks.length > 0) {
      cleanupCallbacks.pop()?.();
    }
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not reconnect after the server closes with 4003 and reports the socket as unavailable", () => {
    const { latest } = mountHook();
    const first = MockWebSocket.instances[0];
    expect(first).toBeDefined();

    act(() => {
      first.triggerOpen();
    });
    act(() => {
      first.serverMessage({
        type: "error",
        code: "FORBIDDEN_ORIGIN",
        message: "Origin not allowed",
      });
      first.serverClose(LIVE_WS_CLOSE_FORBIDDEN_ORIGIN, "Forbidden origin");
    });

    // Walk through the whole back-off ladder (1s .. 30s) several times over:
    // a looping client would have opened many more sockets by now.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(MockWebSocket.instances.length).toBe(1);
    const state = latest();
    expect(state.isConnected).toBe(false);
    expect(state.isConnecting).toBe(false);
    expect(state.unavailable).toBe(true);
    expect(state.error).toMatch(/origin/i);
  });

  it("still reconnects after an ordinary close (control)", () => {
    mountHook();
    const first = MockWebSocket.instances[0];
    act(() => {
      first.triggerOpen();
    });
    act(() => {
      first.serverClose(1006, "");
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });
});
