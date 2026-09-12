#!/usr/bin/env node
/**
 * OmniRoute — UI i18n key coverage gate.
 *
 * Compares every `src/i18n/messages/<locale>.json` against `en.json` and
 * reports:
 *   - total_en:    total leaves in en.json
 *   - present:     leaves present in the locale (any shape match)
 *   - missing:     leaves absent in the locale
 *   - placeholder: leaves whose value starts with __MISSING__:
 *   - coverage:    (present - placeholder) / total_en * 100
 *
 * It ALSO rejects humanized-key placeholders in the ENGLISH catalog (audit C-04):
 * a value such as `"apiRegionHint": "Api Region Hint"` is the camelCase key re-spaced —
 * what the sync/fill scripts emit when nobody wrote the English copy — and the dashboard
 * renders it verbatim ("Azure Open Ai Base Url Hint", "Expiration Banner Expired").
 * Key presence cannot see that, so every EN leaf whose value equals its humanized key
 * AND names a rendering role (hint/label/placeholder/desc/title/banner/aria…) fails the
 * gate unless it is listed in `config/quality/i18n-placeholder-baseline.json`. The
 * baseline freezes pre-existing debt; it never admits new placeholders. Fixed keys are
 * reported as stale baseline entries — prune them with `--update-placeholder-baseline`.
 *
 * Usage:
 *   npm run i18n:check-ui-coverage              # threshold 80, fail on drop
 *   npm run i18n:check-ui-coverage -- --threshold=75
 *   npm run i18n:check-ui-coverage -- --report  # informational tabular output
 *   npm run i18n:check-ui-coverage -- --json    # machine-readable report
 *   npm run i18n:check-ui-coverage -- --update-placeholder-baseline
 *
 * Exits 1 when any locale falls below `--threshold` (default 80) or when the English
 * catalog holds a non-baselined placeholder value, unless `--report` is set, in which
 * case the findings are printed and exit code is 0.
 *
 * Tests point the gate at fixtures through OMNIROUTE_I18N_MESSAGES_DIR and
 * OMNIROUTE_I18N_PLACEHOLDER_BASELINE.
 */

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const MESSAGES_DIR =
  process.env.OMNIROUTE_I18N_MESSAGES_DIR || path.join(ROOT, "src", "i18n", "messages");
const CONFIG_PATH = path.join(ROOT, "config", "i18n.json");
const PLACEHOLDER_BASELINE_PATH =
  process.env.OMNIROUTE_I18N_PLACEHOLDER_BASELINE ||
  path.join(ROOT, "config", "quality", "i18n-placeholder-baseline.json");
const SOURCE_LOCALE = "en";
const PLACEHOLDER_PREFIX = "__MISSING__:";

// Words that name the ROLE of a string (where it is rendered), never its copy. A value
// that is exactly its camelCase key re-spaced AND carries one of these words is the
// humanized-key placeholder, not English a human wrote. Single-word keys (`close`,
// `never`) and role-free multi-word keys (`providersOverview` = "Providers Overview")
// legitimately equal their humanized key and are never flagged.
const ROLE_WORDS_ANYWHERE = new Set([
  "hint",
  "label",
  "placeholder",
  "desc",
  "description",
  "tooltip",
  "aria",
  "banner",
  "heading",
  "subtitle",
  "caption",
]);
const ROLE_WORDS_TRAILING = new Set(["title", "text", "body"]);

function logInfo(...parts) {
  console.log("[i18n-ui-coverage]", ...parts);
}
function logWarn(...parts) {
  console.warn("[i18n-ui-coverage] WARN", ...parts);
}

function parseArgs(argv) {
  const opts = { threshold: 80, report: false, json: false, updatePlaceholderBaseline: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--threshold=")) {
      opts.threshold = Number(arg.slice(12));
    } else if (arg === "--report") {
      opts.report = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--update-placeholder-baseline") {
      opts.updatePlaceholderBaseline = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/i18n/check-ui-keys-coverage.mjs [options]",
          "",
          "  --threshold=<n>                Minimum coverage % for every locale (default 80)",
          "  --report                       Print full coverage table, exit 0 regardless",
          "  --json                         Emit JSON report to stdout",
          "  --update-placeholder-baseline  Rewrite config/quality/i18n-placeholder-baseline.json",
          "                                 from the placeholder values currently in en.json",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(opts.threshold) || opts.threshold < 0 || opts.threshold > 100) {
    throw new Error(`Invalid --threshold value: ${opts.threshold}`);
  }
  return opts;
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectLeafPaths(obj, prefix = []) {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const next = [...prefix, key];
    if (isPlainObject(value)) {
      paths.push(...collectLeafPaths(value, next));
    } else {
      paths.push(next);
    }
  }
  return paths;
}

/** Flatten a nested message catalog into `{ "a.b.c": value }` (insertion order kept). */
export function flattenLeaves(node, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(node ?? {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenLeaves(value, dotted, out);
    } else {
      Object.defineProperty(out, dotted, { value, enumerable: true, writable: true });
    }
  }
  return out;
}

/** "azureOpenAiBaseUrlHint" → ["azure", "Open", "Ai", "Base", "Url", "Hint"]. */
export function splitKeySegmentWords(segment) {
  return String(segment ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean);
}

/** The exact text the placeholder generator emits for a key segment. */
export function humanizeKeySegment(segment) {
  return splitKeySegmentWords(segment)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** True when `value` is the humanized form of `key`'s last segment and names a role. */
export function isHumanizedPlaceholderValue(key, value) {
  if (typeof value !== "string") return false;
  const segment = String(key).split(".").pop();
  const words = splitKeySegmentWords(segment);
  if (words.length < 2) return false;
  if (value.trim() !== humanizeKeySegment(segment)) return false;
  const lower = words.map((word) => word.toLowerCase());
  return (
    lower.some((word) => ROLE_WORDS_ANYWHERE.has(word)) ||
    ROLE_WORDS_TRAILING.has(lower[lower.length - 1])
  );
}

/**
 * Classify every EN leaf: `violations` (placeholder, not baselined — fails the gate),
 * `baselined` (known debt), `stale` (baseline entries that are no longer placeholders).
 */
export function findHumanizedPlaceholderValues(flatEn, baselineKeys = []) {
  const baseline = new Set(baselineKeys);
  const entries = new Map(Object.entries(flatEn ?? {}));
  const violations = [];
  const baselined = [];
  for (const [key, value] of entries) {
    if (!isHumanizedPlaceholderValue(key, value)) continue;
    (baseline.has(key) ? baselined : violations).push({ key, value });
  }
  const stale = [...baseline].filter(
    (key) => !entries.has(key) || !isHumanizedPlaceholderValue(key, entries.get(key))
  );
  return { violations, baselined, stale };
}

/** Baseline file shape: `{ "keys": ["ns.keyHint", …] }`; a missing file is an empty baseline. */
export async function loadPlaceholderBaseline(filePath = PLACEHOLDER_BASELINE_PATH) {
  if (!existsSync(filePath)) return [];
  const parsed = await loadJson(filePath);
  const keys = isPlainObject(parsed) ? parsed.keys : parsed;
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
    throw new Error(`Invalid placeholder baseline (expected { keys: string[] }): ${filePath}`);
  }
  return keys;
}

async function writePlaceholderBaseline(filePath, keys) {
  const payload = {
    $comment:
      "English catalog leaves whose value is still the humanized key (e.g. apiRegionHint = 'Api Region Hint'). " +
      "Frozen debt for scripts/i18n/check-ui-keys-coverage.mjs — never add keys by hand; write the real copy instead. " +
      "Regenerate with: node scripts/i18n/check-ui-keys-coverage.mjs --update-placeholder-baseline",
    keys: [...keys].sort(),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

// Reject any segment that could traverse into the object prototype chain. This
// is defensive — our inputs are JSON files we authored, but the static
// scanner correctly flags any dynamic indexing with untrusted-looking keys.
const FORBIDDEN_KEY_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function lookupPath(obj, parts) {
  let cur = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    if (FORBIDDEN_KEY_SEGMENTS.has(part)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    // Use Map-like get via Object.entries to avoid dynamic bracket access
    // patterns the static analyzer warns about. We already validated the key
    // exists as an own property above.
    const entry = Object.entries(cur).find(([k]) => k === part);
    cur = entry ? entry[1] : undefined;
  }
  return cur;
}

function pad(str, width) {
  const s = String(str);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
function padLeft(str, width) {
  const s = String(str);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

async function main() {
  const opts = parseArgs(process.argv);

  const sourcePath = path.join(MESSAGES_DIR, `${SOURCE_LOCALE}.json`);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source messages file not found: ${sourcePath}`);
  }
  const source = await loadJson(sourcePath);
  const enPaths = collectLeafPaths(source);
  const totalEn = enPaths.length;

  // Locale set: every <code>.json on disk except en, intersected with config.
  let configCodes = null;
  if (existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
      if (Array.isArray(cfg.locales)) {
        configCodes = new Set(cfg.locales.map((l) => l.code));
      }
    } catch {
      /* ignore — fall back to disk listing only */
    }
  }
  const onDisk = (await fs.readdir(MESSAGES_DIR))
    .filter((f) => f.endsWith(".json") && f !== `${SOURCE_LOCALE}.json`)
    .map((f) => f.slice(0, -5))
    .filter((code) => (configCodes ? configCodes.has(code) : true))
    .sort();

  const results = [];
  for (const locale of onDisk) {
    const localePath = path.join(MESSAGES_DIR, `${locale}.json`);
    let target;
    try {
      target = await loadJson(localePath);
    } catch (err) {
      logWarn(`${locale}: failed to parse JSON (${err.message})`);
      results.push({
        locale,
        total_en: totalEn,
        present: 0,
        missing: totalEn,
        placeholder: 0,
        coverage: 0,
      });
      continue;
    }

    let present = 0;
    let missing = 0;
    let placeholder = 0;
    for (const pathParts of enPaths) {
      const value = lookupPath(target, pathParts);
      if (value === undefined) {
        missing++;
        continue;
      }
      // Treat plain objects at scalar positions as missing — shape mismatch.
      if (isPlainObject(value)) {
        missing++;
        continue;
      }
      present++;
      if (typeof value === "string" && value.startsWith(PLACEHOLDER_PREFIX)) {
        placeholder++;
      }
    }
    const real = present - placeholder;
    const coverage = totalEn === 0 ? 100 : (real / totalEn) * 100;
    results.push({ locale, total_en: totalEn, present, missing, placeholder, coverage });
  }

  const failures = results.filter((r) => r.coverage < opts.threshold);

  // English placeholder values (C-04) — baseline-backed.
  const flatEn = flattenLeaves(source);
  let baselineKeys = await loadPlaceholderBaseline(PLACEHOLDER_BASELINE_PATH);
  if (opts.updatePlaceholderBaseline) {
    const current = findHumanizedPlaceholderValues(flatEn, []).violations.map((v) => v.key);
    await writePlaceholderBaseline(PLACEHOLDER_BASELINE_PATH, current);
    logInfo(
      `placeholder baseline rewritten: ${current.length} key(s) → ${path.relative(ROOT, PLACEHOLDER_BASELINE_PATH)}`
    );
    baselineKeys = current;
  }
  const placeholderValues = findHumanizedPlaceholderValues(flatEn, baselineKeys);
  const placeholderFailed = placeholderValues.violations.length > 0;

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          source: SOURCE_LOCALE,
          totalKeys: totalEn,
          threshold: opts.threshold,
          ok: failures.length === 0 && !placeholderFailed,
          results,
          placeholderValues: {
            baseline: path.relative(ROOT, PLACEHOLDER_BASELINE_PATH),
            baselined: placeholderValues.baselined.length,
            stale: placeholderValues.stale,
            violations: placeholderValues.violations,
          },
        },
        null,
        2
      ) + "\n"
    );
    if ((failures.length || placeholderFailed) && !opts.report) process.exit(1);
    return;
  }

  // Human-readable output (table).
  const localeW = Math.max(8, ...results.map((r) => r.locale.length));
  const header =
    pad("locale", localeW) +
    "  " +
    padLeft("coverage", 10) +
    "  " +
    padLeft("real", 6) +
    "  " +
    padLeft("present", 7) +
    "  " +
    padLeft("missing", 7) +
    "  " +
    padLeft("placeholder", 11) +
    "  " +
    padLeft("total_en", 8);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    const real = r.present - r.placeholder;
    const pct = `${r.coverage.toFixed(1)}%`;
    const marker = r.coverage < opts.threshold ? " ✗" : "";
    console.log(
      pad(r.locale, localeW) +
        "  " +
        padLeft(pct, 10) +
        "  " +
        padLeft(real, 6) +
        "  " +
        padLeft(r.present, 7) +
        "  " +
        padLeft(r.missing, 7) +
        "  " +
        padLeft(r.placeholder, 11) +
        "  " +
        padLeft(r.total_en, 8) +
        marker
    );
  }

  if (placeholderValues.stale.length) {
    logWarn(
      `${placeholderValues.stale.length} baseline entr${placeholderValues.stale.length === 1 ? "y is" : "ies are"} no longer placeholder(s) — prune with --update-placeholder-baseline:`
    );
    for (const key of placeholderValues.stale) console.log(`  - ${key}`);
  }
  logInfo(
    `English placeholder values: ${placeholderValues.violations.length} new, ${placeholderValues.baselined.length} baselined.`
  );
  if (placeholderFailed) {
    logInfo(
      `${opts.report ? "" : "FAIL — "}${placeholderValues.violations.length} English value(s) are still the humanized key (write the real copy in ${SOURCE_LOCALE}.json):`
    );
    for (const { key, value } of placeholderValues.violations) {
      console.log(`  - ${key} = ${JSON.stringify(value)}`);
    }
  }

  const failed = failures.length > 0 || placeholderFailed;
  if (failed) {
    if (opts.report) {
      logInfo(
        `${failures.length} locale(s) below threshold ${opts.threshold}%, ${placeholderValues.violations.length} placeholder value(s) — report mode, exiting 0.`
      );
    } else {
      if (failures.length) {
        logInfo(`FAIL — ${failures.length} locale(s) below threshold ${opts.threshold}%.`);
        for (const f of failures) {
          console.log(`  - ${f.locale}: ${f.coverage.toFixed(1)}%`);
        }
      }
      process.exit(1);
    }
  } else {
    logInfo(
      `PASS — all ${results.length} locale(s) at or above ${opts.threshold}% coverage; no new English placeholder values.`
    );
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error("[i18n-ui-coverage] ERROR", err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
