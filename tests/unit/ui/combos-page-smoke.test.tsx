// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// The first import transforms the entire combos page graph — the largest in the
// dashboard. Cold, in isolation, that is ~9s here; inside the full 20-worker
// `test:vitest:ui` run it exceeded even the 30s transform budget the other smoke suites
// use (measured: the one red file of a 364-file run), so this one gets 60s.
describe("combos page memoization", { timeout: 60000 }, () => {
  it("combos page module exports a default component", async () => {
    const mod = await import("@/app/(dashboard)/dashboard/combos/page");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
