// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// The first import transforms the whole EvalsTab component graph (recharts, shared
// dashboard chrome); on a cold cache that alone exceeds vitest's 5s default, so the
// suite carries the same 30s budget agent-card.test.tsx uses for transform overhead.
describe("EvalsTab memoization", { timeout: 30000 }, () => {
  it("EvalsTab page module exports a default component", async () => {
    const mod = await import("@/app/(dashboard)/dashboard/usage/components/EvalsTab");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
