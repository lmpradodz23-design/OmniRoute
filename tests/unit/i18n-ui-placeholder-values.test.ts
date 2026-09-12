import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs gate script, no type declarations by design.
import {
  findHumanizedPlaceholderValues,
  flattenLeaves,
  humanizeKeySegment,
  isHumanizedPlaceholderValue,
} from "../../scripts/i18n/check-ui-keys-coverage.mjs";

// Why this gate exists (audit C-04): `check-ui-keys-coverage.mjs` counted key PRESENCE
// only, so an English catalog entry such as
//
//   "apiRegionHint": "Api Region Hint"
//
// (the camelCase key re-spaced — what the sync/fill scripts emit when nobody wrote the
// English copy) scored as 100% covered while the dashboard literally rendered
// "Api Region Hint", "Azure Open Ai Base Url Hint" and "Expiration Banner Expired" to
// operators. The gate must fail on such values, with a baseline that freezes the
// pre-existing debt without letting new placeholders in.

const SCRIPT = fileURLToPath(
  new URL("../../scripts/i18n/check-ui-keys-coverage.mjs", import.meta.url)
);

test("humanizeKeySegment re-spaces camelCase the way the placeholder generator does", () => {
  assert.equal(humanizeKeySegment("apiRegionHint"), "Api Region Hint");
  assert.equal(humanizeKeySegment("azureOpenAiBaseUrlHint"), "Azure Open Ai Base Url Hint");
  assert.equal(
    humanizeKeySegment("compatUpstreamHeaderNamePlaceholder"),
    "Compat Upstream Header Name Placeholder"
  );
  assert.equal(humanizeKeySegment("close"), "Close");
});

test("a value equal to the humanized key with a role word is a placeholder", () => {
  assert.equal(isHumanizedPlaceholderValue("providers.apiRegionHint", "Api Region Hint"), true);
  assert.equal(
    isHumanizedPlaceholderValue("providers.azureOpenAiBaseUrlHint", "Azure Open Ai Base Url Hint"),
    true
  );
  assert.equal(
    isHumanizedPlaceholderValue("providers.expirationBannerExpired", "Expiration Banner Expired"),
    true,
    "'banner' names where the string is rendered, never its copy"
  );
  assert.equal(
    isHumanizedPlaceholderValue("settings.systemPromptText", "System Prompt Text"),
    true
  );
});

test("real copy that happens to match its key is NOT a placeholder", () => {
  // single-word keys are naturally equal to their value
  assert.equal(isHumanizedPlaceholderValue("common.close", "Close"), false);
  assert.equal(isHumanizedPlaceholderValue("settings.never", "Never"), false);
  // multi-word keys without a role word are legitimate headings/buttons
  assert.equal(isHumanizedPlaceholderValue("home.providersOverview", "Providers Overview"), false);
  assert.equal(isHumanizedPlaceholderValue("common.testConnection", "Test Connection"), false);
  // a role-word key with REAL copy is fine
  assert.equal(
    isHumanizedPlaceholderValue(
      "providers.apiRegionHint",
      "Select the endpoint region for API access and quota tracking."
    ),
    false
  );
  assert.equal(isHumanizedPlaceholderValue("providers.count", 3), false);
});

test("findHumanizedPlaceholderValues splits violations / baselined / stale", () => {
  const flatEn = flattenLeaves({
    providers: {
      apiRegionHint: "Api Region Hint",
      azureOpenAiBaseUrlHint: "Azure Open Ai Base Url Hint",
      close: "Close",
      regionHint: "Pick the closest region.",
    },
  });
  const result = findHumanizedPlaceholderValues(flatEn, [
    "providers.azureOpenAiBaseUrlHint",
    "providers.regionHint",
  ]);
  assert.deepEqual(result.violations, [
    { key: "providers.apiRegionHint", value: "Api Region Hint" },
  ]);
  assert.deepEqual(result.baselined, [
    { key: "providers.azureOpenAiBaseUrlHint", value: "Azure Open Ai Base Url Hint" },
  ]);
  assert.deepEqual(result.stale, ["providers.regionHint"], "fixed keys must leave the baseline");
});

function runGate(messagesDir: string, baselinePath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, "--threshold=0", ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      OMNIROUTE_I18N_MESSAGES_DIR: messagesDir,
      OMNIROUTE_I18N_PLACEHOLDER_BASELINE: baselinePath,
    },
  });
}

test("the gate script fails on a non-baselined placeholder and passes once baselined", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-i18n-placeholder-"));
  try {
    const messagesDir = path.join(dir, "messages");
    fs.mkdirSync(messagesDir);
    const baselinePath = path.join(dir, "baseline.json");
    fs.writeFileSync(
      path.join(messagesDir, "en.json"),
      JSON.stringify(
        { providers: { apiRegionHint: "Api Region Hint", title: "Providers" } },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(messagesDir, "pt-BR.json"),
      JSON.stringify({ providers: { apiRegionHint: "Api Region Hint", title: "Provedores" } })
    );

    const red = runGate(messagesDir, baselinePath);
    assert.equal(red.status, 1, `expected FAIL, got:\n${red.stdout}\n${red.stderr}`);
    assert.match(red.stdout + red.stderr, /providers\.apiRegionHint/);
    assert.match(red.stdout + red.stderr, /Api Region Hint/);

    const report = runGate(messagesDir, baselinePath, ["--report"]);
    assert.equal(report.status, 0, "--report is informational and never fails");
    assert.match(report.stdout + report.stderr, /providers\.apiRegionHint/);

    const json = runGate(messagesDir, baselinePath, ["--json", "--report"]);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.placeholderValues.violations, [
      { key: "providers.apiRegionHint", value: "Api Region Hint" },
    ]);

    fs.writeFileSync(baselinePath, JSON.stringify({ keys: ["providers.apiRegionHint"] }));
    const green = runGate(messagesDir, baselinePath);
    assert.equal(green.status, 0, `expected PASS, got:\n${green.stdout}\n${green.stderr}`);
    assert.match(green.stdout, /PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--update-placeholder-baseline rewrites the baseline from the current catalog", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-i18n-placeholder-"));
  try {
    const messagesDir = path.join(dir, "messages");
    fs.mkdirSync(messagesDir);
    const baselinePath = path.join(dir, "baseline.json");
    fs.writeFileSync(
      path.join(messagesDir, "en.json"),
      JSON.stringify({ a: { zHint: "Z Hint", bLabel: "B Label", ok: "Fine" } })
    );
    fs.writeFileSync(path.join(messagesDir, "pt-BR.json"), JSON.stringify({ a: { ok: "Bem" } }));
    fs.writeFileSync(baselinePath, JSON.stringify({ keys: ["a.gone"] }));

    const updated = runGate(messagesDir, baselinePath, ["--update-placeholder-baseline"]);
    assert.equal(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    assert.deepEqual(baseline.keys, ["a.bLabel", "a.zHint"], "sorted, stale entry dropped");

    const green = runGate(messagesDir, baselinePath);
    assert.equal(green.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real English catalog has no placeholder value outside the baseline", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const en = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/messages/en.json"), "utf8"));
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, "config/quality/i18n-placeholder-baseline.json"), "utf8")
  );
  const { violations } = findHumanizedPlaceholderValues(flattenLeaves(en), baseline.keys);
  assert.deepEqual(violations, []);
  // The C-04 keys the audit saw rendered verbatim must be fixed, not baselined.
  for (const key of [
    "providers.azureOpenAiBaseUrlHint",
    "providers.apiRegionHint",
    "providers.consoleApiKeyOracleHint",
    "providers.compatUpstreamHeaderNamePlaceholder",
    "providers.expirationBannerExpired",
  ]) {
    assert.equal(baseline.keys.includes(key), false, `${key} must not be baselined`);
  }
});
