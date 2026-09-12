/**
 * Loop Engine + Buzz Hub — i18n contract (audit A-M4 / B-M6).
 *
 * Mirrors settings-i18n-keys.test.ts / gamification-admin-sidebar-i18n.test.ts for the
 * keys this branch introduced: the sidebar items, the two feature flags and every
 * `t("…")` the two dashboard pages (and their sub-components) call must resolve in
 * en.json; pt-BR, pt and vi carry real copy (vi bans `__MISSING__` markers); every other
 * locale carries the key (parity, placeholder allowed); no Portuguese is hard-coded in
 * the source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { SIDEBAR_SECTIONS, getSectionItems } =
  await import("../../src/shared/constants/sidebarVisibility.ts");
const { FEATURE_FLAG_DEFINITIONS } =
  await import("../../src/shared/constants/featureFlagDefinitions.ts");

type Messages = Record<string, unknown>;

function readJson(relativePath: string): Messages {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as Messages;
}

function getMessage(messages: Messages, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Messages)[segment];
  }, messages);
}

function leafKeys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [prefix];
  return Object.entries(node as Messages).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

const MESSAGES_DIR = "src/i18n/messages";
const en = readJson(`${MESSAGES_DIR}/en.json`);

const PAGE_DIRS = [
  "src/app/(dashboard)/dashboard/loop",
  "src/app/(dashboard)/dashboard/buzz",
] as const;
const NAMESPACES = ["loopEngine", "buzzHub"] as const;
const SIDEBAR_KEYS = [
  "sidebar.loopEngine",
  "sidebar.loopEngineSubtitle",
  "sidebar.buzzHub",
  "sidebar.buzzHubSubtitle",
];
const FLAG_KEYS = ["LOOP_ENGINE_ENABLED", "BUZZ_HUB_ENABLED"] as const;
const FLAG_DESCRIPTION_KEYS = FLAG_KEYS.map((key) => `featureFlags.definitions.${key}.description`);
const REAL_COPY_LOCALES = ["pt-BR", "pt", "vi"] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => path.join(dir, name));
}

/** `t("key")`, `t.rich("key", …)` and the `t(cond ? "a" : "b")` ternaries the pages use. */
function translationKeysIn(source: string): string[] {
  const keys = new Set<string>();
  for (const m of source.matchAll(/\bt(?:\.rich)?\(\s*"([^"]+)"/g)) keys.add(m[1]);
  for (const m of source.matchAll(/\bt(?:\.rich)?\(\s*\w+\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)) {
    keys.add(m[1]);
    keys.add(m[2]);
  }
  return [...keys];
}

test("Loop and Buzz sidebar items carry English fallbacks and resolvable keys", () => {
  const section = SIDEBAR_SECTIONS.find((s) =>
    getSectionItems(s).some((entry) => entry.id === "loop")
  );
  assert.ok(section, "a sidebar section must list the loop item");
  const items = getSectionItems(section);
  const loop = items.find((entry) => entry.id === "loop");
  const buzz = items.find((entry) => entry.id === "buzz");
  assert.ok(loop && buzz, "loop and buzz items must sit in the same section");

  assert.equal(loop.href, "/dashboard/loop");
  assert.equal(loop.i18nKey, "loopEngine");
  assert.equal(loop.subtitleKey, "loopEngineSubtitle");
  assert.equal(buzz.href, "/dashboard/buzz");
  assert.equal(buzz.i18nKey, "buzzHub");
  assert.equal(buzz.subtitleKey, "buzzHubSubtitle");

  for (const item of [loop, buzz]) {
    for (const fallback of [item.labelFallback, item.subtitleFallback]) {
      if (fallback === undefined) continue;
      assert.doesNotMatch(fallback, /[ãõçáéíóú]/i, `fallback must be English: ${fallback}`);
    }
  }
  for (const key of SIDEBAR_KEYS) {
    assert.equal(typeof getMessage(en, key), "string", `en.${key} must exist`);
  }
  assert.equal(getMessage(en, "sidebar.loopEngine"), loop.labelFallback);
  assert.equal(getMessage(en, "sidebar.loopEngineSubtitle"), loop.subtitleFallback);
  assert.equal(getMessage(en, "sidebar.buzzHub"), buzz.labelFallback);
  assert.equal(getMessage(en, "sidebar.buzzHubSubtitle"), buzz.subtitleFallback);
});

test("the two feature flags resolve their description keys in en.json", () => {
  for (const flagKey of FLAG_KEYS) {
    const definition = FEATURE_FLAG_DEFINITIONS.find((d) => d.key === flagKey);
    assert.ok(definition, `${flagKey} must be defined`);
    assert.equal(
      typeof getMessage(en, definition.descriptionI18nKey),
      "string",
      `en.${definition.descriptionI18nKey} must exist`
    );
    assert.equal(
      typeof getMessage(en, `featureFlags.definitions.${flagKey}.description`),
      "string",
      `en.featureFlags.definitions.${flagKey}.description must exist`
    );
  }
});

test("every translation key the Loop and Buzz pages use resolves in en.json", () => {
  for (const dir of PAGE_DIRS) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      const namespaces = [...source.matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)].map(
        (m) => m[1]
      );
      const keys = translationKeysIn(source);
      if (keys.length === 0) continue;
      if (namespaces.length === 0) {
        // Shared helper translated through the caller: its keys must exist in every page namespace.
        for (const ns of NAMESPACES) {
          for (const key of keys) {
            const value = getMessage(en, `${ns}.${key}`);
            assert.equal(typeof value, "string", `${file}: t("${key}") must exist in en.${ns}`);
          }
        }
        continue;
      }
      for (const key of keys) {
        const resolved = namespaces.some(
          (ns) => typeof getMessage(en, `${ns}.${key}`) === "string"
        );
        assert.ok(resolved, `${file}: t("${key}") resolves in none of [${namespaces}]`);
      }
    }
  }
  const pages = PAGE_DIRS.map((dir) =>
    readFileSync(path.join(repoRoot, `${dir}/page.tsx`), "utf8")
  );
  assert.match(pages[0], /useTranslations\("loopEngine"\)/);
  assert.match(pages[1], /useTranslations\("buzzHub"\)/);
});

test("the Loop and Buzz sources carry no hard-coded Portuguese copy", () => {
  const leftovers = [
    "Iniciar ciclo",
    "Rejeitar",
    "Aprovar",
    "Nenhum ciclo",
    "Falha ao",
    "Abrir Feature Flags",
    "URL do relay",
    "Publicar pendentes",
    "Copiado!",
    "Salvando",
    "está desligado",
  ];
  for (const dir of PAGE_DIRS) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      for (const raw of leftovers) {
        assert.equal(source.includes(raw), false, `${file} still hard-codes "${raw}"`);
      }
    }
  }
});

test("pt-BR, pt and vi carry real copy for every new key", () => {
  const newKeys = [
    ...NAMESPACES.flatMap((ns) => leafKeys(getMessage(en, ns), ns)),
    ...SIDEBAR_KEYS,
    ...FLAG_DESCRIPTION_KEYS,
  ];
  assert.ok(newKeys.length > 40, `expected the namespaces to be populated, got ${newKeys.length}`);
  for (const locale of REAL_COPY_LOCALES) {
    const messages = readJson(`${MESSAGES_DIR}/${locale}.json`);
    for (const key of newKeys) {
      const value = getMessage(messages, key);
      assert.equal(typeof value, "string", `${locale}.${key} must exist`);
      assert.ok((value as string).trim(), `${locale}.${key} must not be empty`);
      assert.doesNotMatch(value as string, /__MISSING__/, `${locale}.${key} is untranslated`);
    }
  }
});

test("every other locale carries the new keys (placeholder allowed)", () => {
  const newKeys = [
    ...NAMESPACES.flatMap((ns) => leafKeys(getMessage(en, ns), ns)),
    ...SIDEBAR_KEYS,
    ...FLAG_DESCRIPTION_KEYS,
  ];
  const locales = readdirSync(path.join(repoRoot, MESSAGES_DIR))
    .filter((name) => name.endsWith(".json") && name !== "en.json")
    .map((name) => name.slice(0, -5));
  for (const locale of locales) {
    const messages = readJson(`${MESSAGES_DIR}/${locale}.json`);
    for (const key of newKeys) {
      assert.equal(typeof getMessage(messages, key), "string", `${locale}.${key} must exist`);
    }
  }
});
