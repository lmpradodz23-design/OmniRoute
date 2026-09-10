// @vitest-environment jsdom
// Vitest suite: tests/unit/dashboard/**/*.test.tsx is collected by vitest.config.ts
// (the node:test runner only globs `*.test.ts` in this directory). Written against
// node:test originally, vitest reported "No test suite found in file" and the suite
// never ran anywhere.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ComboSortSelect } from "@/app/(dashboard)/dashboard/combos/ComboSortSelect";

const t = (_k: string, f: string) => f;

afterEach(() => cleanup());

describe("ComboSortSelect", () => {
  it("renders four options and emits the chosen method", () => {
    let chosen = "";
    render(<ComboSortSelect value="manual" onChange={(mm) => (chosen = mm)} t={t} />);
    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).options.length).toBe(4);
    fireEvent.change(select, { target: { value: "provider" } });
    expect(chosen).toBe("provider");
  });
});
