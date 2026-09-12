/**
 * Browser Use domain allowlist card — i18n contract.
 *
 * Every `t("…")` the card sources call resolves in `en.browserAllowlist`; every reason code the
 * API can return maps to a real key; pt-BR, pt, vi, es, fr, de and it carry real copy (no
 * `__MISSING__` marker, not the English text verbatim for prose keys) with the same ICU
 * placeholders and rich tags as English; every other locale at least carries the key.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MESSAGES_DIR = path.join(repoRoot, "src/i18n/messages");
const CARD_DIR = "src/app/(dashboard)/dashboard/settings/components/browserAllowlist";
const REAL_COPY_LOCALES = ["pt-BR", "pt", "vi", "es", "fr", "de", "it"] as const;
/** Values that are legitimately identical across languages. */
const VERBATIM_OK = new Set(["addPlaceholder"]);

type Messages = Record<string, unknown>;

function readLocale(locale: string): Messages {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Messages;
}

const en = readLocale("en").browserAllowlist as Record<string, string>;

function sources(): Array<{ file: string; source: string }> {
  return readdirSync(path.join(repoRoot, CARD_DIR))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => ({
      file: name,
      source: readFileSync(path.join(repoRoot, CARD_DIR, name), "utf8"),
    }));
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}|<(\/?\w+)>/g)].map((m) => m[1] ?? m[2]).sort();
}

test("en.browserAllowlist is populated", () => {
  assert.ok(en && typeof en === "object");
  assert.ok(Object.keys(en).length >= 40, `got ${Object.keys(en).length} keys`);
});

test("every t() key and every reason key used by the card resolves in en", () => {
  let checked = 0;
  for (const { file, source } of sources()) {
    const keys = new Set<string>();
    for (const m of source.matchAll(/\bt(?:\.rich)?\(\s*"([^"]+)"/g)) keys.add(m[1]);
    for (const m of source.matchAll(/:\s*"(reason[A-Z]\w+)"/g)) keys.add(m[1]);
    for (const key of keys) {
      assert.equal(typeof en[key], "string", `${file}: t("${key}") missing in en.browserAllowlist`);
      checked += 1;
    }
    if (keys.size > 0) assert.match(source, /useTranslations\("browserAllowlist"\)/, file);
  }
  assert.ok(checked > 30, `expected the card to use many keys, checked ${checked}`);
});

test("the API rejection reasons all have a translated key", () => {
  const route = readFileSync(path.join(repoRoot, "src/lib/db/browserGuard.ts"), "utf8");
  const union = route.match(/export type BrowserDomainRejection =([^;]+);/);
  assert.ok(union, "BrowserDomainRejection union not found");
  const reasons = [...union[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.equal(reasons.length, 7);
  const editor = readFileSync(path.join(repoRoot, CARD_DIR, "AllowlistEditor.tsx"), "utf8");
  for (const reason of reasons) {
    assert.match(
      editor,
      new RegExp(`\\b${reason}: "reason\\w+"`),
      `${reason} has no REASON_KEYS entry`
    );
  }
});

test("real copy in pt-BR, pt, vi, es, fr, de and it with matching placeholders", () => {
  for (const locale of REAL_COPY_LOCALES) {
    const ns = readLocale(locale).browserAllowlist as Record<string, unknown>;
    assert.ok(ns, `${locale}.browserAllowlist must exist`);
    for (const [key, english] of Object.entries(en)) {
      const value = ns[key];
      assert.equal(typeof value, "string", `${locale}.${key} must exist`);
      assert.doesNotMatch(value as string, /__MISSING__/, `${locale}.${key} is untranslated`);
      assert.ok((value as string).trim(), `${locale}.${key} must not be empty`);
      assert.deepEqual(
        placeholders(value as string),
        placeholders(english),
        `${locale}.${key} placeholders`
      );
      if (!VERBATIM_OK.has(key) && english.length > 12) {
        assert.notEqual(value, english, `${locale}.${key} is still the English text`);
      }
    }
  }
});

test("every locale carries every browserAllowlist key (parity)", () => {
  const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
  assert.ok(locales.length > 30);
  for (const file of locales) {
    const ns = readLocale(file.replace(/\.json$/, "")).browserAllowlist as Record<string, unknown>;
    for (const key of Object.keys(en)) {
      assert.equal(typeof ns?.[key], "string", `${file}: browserAllowlist.${key} missing`);
    }
  }
});

test("the card sources hard-code no user-visible English or Portuguese copy", () => {
  const leftovers = [
    "Save allowlist",
    "Clear all",
    "Add a domain",
    "Salvar",
    "Limpar",
    "Adicionar",
  ];
  for (const { file, source } of sources()) {
    for (const raw of leftovers) {
      assert.equal(
        source.includes(`>${raw}<`) || source.includes(`"${raw}"`),
        false,
        `${file}: "${raw}"`
      );
    }
  }
});
