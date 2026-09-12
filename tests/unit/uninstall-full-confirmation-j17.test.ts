// J17 (audit/04-PRODUCT-GAPS.md): `npm run uninstall:full` erased the whole data
// directory (database, API keys, backups) with no confirmation — one mistyped script
// name away from irreversible loss. The decision is a pure function so the rules are
// testable without touching a real data directory or npm.
import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { planUninstall } from "../../scripts/build/uninstallPlan.mjs";

const dataDir = "/home/user/.omniroute";

test("the uninstaller resolves the data directory like the app does (no ~/.omniroute hardcode)", () => {
  // On Windows the app writes to %APPDATA%\omniroute (bin/cli/data-dir.mjs); the uninstaller
  // used `DATA_DIR || ~/.omniroute`, so `uninstall:full` erased the wrong path and kept the data.
  const source = fs.readFileSync(
    fileURLToPath(new URL("../../scripts/build/uninstall.mjs", import.meta.url)),
    "utf8"
  );
  assert.match(source, /import \{ resolveDataDir \} from "\.\.\/\.\.\/bin\/cli\/data-dir\.mjs";/);
  assert.match(source, /const dataDir = resolveDataDir\(\);/);
  assert.doesNotMatch(source, /path\.join\(os\.homedir\(\), "\.omniroute"\)/);
});

test("plain uninstall never erases data and says so", () => {
  const plan = planUninstall({ argv: [], dataDir, isTTY: false });
  assert.equal(plan.full, false);
  assert.equal(plan.eraseData, false);
  assert.match(plan.messages.join("\n"), /preserved|kept/i);
  assert.match(
    plan.messages.join("\n"),
    new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("--full without confirmation is refused, non-interactively, with instructions", () => {
  const plan = planUninstall({ argv: ["--full"], dataDir, isTTY: false });
  assert.equal(plan.full, true);
  assert.equal(plan.eraseData, false);
  assert.equal(plan.needsPrompt, false);
  assert.equal(plan.exitCode, 1);
  assert.match(plan.messages.join("\n"), /--yes/);
});

test("--full --yes erases data without prompting (scripted use)", () => {
  const plan = planUninstall({ argv: ["--full", "--yes"], dataDir, isTTY: false });
  assert.equal(plan.eraseData, true);
  assert.equal(plan.needsPrompt, false);
  assert.equal(plan.exitCode, 0);
});

test("--full on a terminal asks the user to type the exact confirmation", () => {
  const plan = planUninstall({ argv: ["--full"], dataDir, isTTY: true });
  assert.equal(plan.needsPrompt, true);
  assert.equal(plan.eraseData, false, "not decided until the answer is checked");
  assert.equal(plan.confirmAnswer("ERASE"), true);
  assert.equal(plan.confirmAnswer("erase"), false, "exact, case-sensitive");
  assert.equal(plan.confirmAnswer("y"), false);
  assert.equal(plan.confirmAnswer(""), false);
});

test("--force is not accepted as a synonym (only the documented --yes)", () => {
  const plan = planUninstall({ argv: ["--full", "--force"], dataDir, isTTY: false });
  assert.equal(plan.eraseData, false);
  assert.equal(plan.exitCode, 1);
});
