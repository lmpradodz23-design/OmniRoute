import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Two vitest configs share the tree: vitest.mcp.config.ts (environment "node", MCP
// tool functional suites) and vitest.config.ts (environment "jsdom", dashboard UI).
// The jsdom config's broad `open-sse/**/__tests__/**/*.test.ts` include used to sweep
// the node-only MCP suites in as well, where their dispatch/fetch mocks fail — and CI
// would report them red under `test:vitest:ui` while `test:vitest` was green. This
// pins the contract: every directory the jsdom config hands off must actually be
// collected by the node config, so excluding it never orphans a suite.

const REPO = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

const NODE_OWNED = [
  "open-sse/mcp-server/__tests__/**",
  "open-sse/services/autoCombo/__tests__/**",
  "open-sse/services/combo/__tests__/**",
];

test("jsdom vitest.config.ts excludes the node-environment suites owned by vitest.mcp.config.ts", () => {
  const ui = read("vitest.config.ts");
  for (const glob of NODE_OWNED) {
    assert.ok(ui.includes(`"${glob}"`), `vitest.config.ts must exclude ${glob}`);
  }
  // The handoff is only safe while the jsdom include is still broad enough to have
  // needed it — if the include is narrowed later, this test becomes moot, not wrong.
  assert.ok(ui.includes('"open-sse/**/__tests__/**/*.test.ts"'));
});

test("vitest.mcp.config.ts collects every directory the jsdom config hands off", () => {
  const mcp = read("vitest.mcp.config.ts");
  assert.match(mcp, /environment:\s*"node"/);
  for (const glob of NODE_OWNED) {
    const include = glob.replace(/\*\*$/, "**/*.test.ts");
    assert.ok(mcp.includes(`"${include}"`), `vitest.mcp.config.ts must include ${include}`);
  }
});

test("the jsdom config carries no #8618 exclusion for a node-owned suite", () => {
  const ui = read("vitest.config.ts");
  const stale = ui
    .split("\n")
    .filter((line) => line.includes("#8618"))
    .filter((line) => NODE_OWNED.some((glob) => line.includes(glob.replace(/\/\*\*$/, "/"))));
  assert.deepEqual(stale, [], "node-owned suites are governed by vitest.mcp.config.ts, not #8618");
});
