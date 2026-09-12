/**
 * P-2 / P-3 (audit/03 §2.3): a plugin's manifest may declare `network`, `file-read`,
 * `file-write`, `exec` permissions, but the loader only enforces `env` (it filters the child
 * process environment) — the plugin runs in a Node.js child with the server's full authority.
 * The product must not claim otherwise. This locks the disclosure in the SDK docs and on the
 * Plugins page.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("PLUGIN_SDK.md no longer claims a sandbox that does not exist", () => {
  const sdk = read("docs/frameworks/PLUGIN_SDK.md");
  assert.doesNotMatch(sdk, /run in a sandboxed VM context/i);
  assert.doesNotMatch(sdk, /globals are simply not available in the sandbox/i);
  // the sentence wraps across a blockquote line ("the same\n> privileges …")
  assert.match(sdk, /same[\s>]+privileges as the OmniRoute server/i);
  assert.match(sdk, /only .*`env`.* is enforced/i);
});

test("the loader really enforces only the env filter (the disclosure stays true)", () => {
  const loader = read("src/lib/plugins/loader.ts");
  assert.match(loader, /getFilteredEnv\(permissions\)/);
  assert.match(loader, /spawn\(process\.execPath, \["--no-warnings"/);
  assert.doesNotMatch(
    loader,
    /--permission/,
    "if the permission model is adopted, update the disclosure"
  );
});

test("the Plugins page shows the trusted-code notice in every catalog", () => {
  const page = read("src/app/(dashboard)/dashboard/plugins/page.tsx");
  assert.match(page, /role="note"/);
  assert.match(page, /t\("trustNotice"\)/);
  for (const locale of ["en", "pt-BR"]) {
    const messages = JSON.parse(read(`src/i18n/messages/${locale}.json`)) as {
      plugins: Record<string, string>;
    };
    assert.ok(messages.plugins.trustNotice.length > 80, `${locale}: trustNotice present`);
    assert.ok(messages.plugins.trustNoticeTitle, `${locale}: trustNoticeTitle present`);
  }
});
