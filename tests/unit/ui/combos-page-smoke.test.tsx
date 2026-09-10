// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// The first import transforms the entire combos page graph; on a cold cache that alone
// exceeds vitest's 5s default, so the suite carries the same 30s budget
// agent-card.test.tsx uses for transform overhead.
describe("combos page memoization", { timeout: 30000 }, () => {
  it("combos page module exports a default component", async () => {
    const mod = await import("@/app/(dashboard)/dashboard/combos/page");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
