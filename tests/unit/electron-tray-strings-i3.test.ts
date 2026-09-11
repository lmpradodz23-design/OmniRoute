// I3 (audit/04-PRODUCT-GAPS.md): every tray menu label, tooltip and update notification
// of the Electron main process was hardcoded in English, so a pt-BR user who chose
// Portuguese in the dashboard still got an English tray. Minimal main-process table
// keyed by the OS locale (pt / en, English fallback), with parameter interpolation.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const {
  createTrayTranslator,
  resolveTrayLocale,
  TRAY_STRINGS,
} = require("../../electron/lib/trayStrings");

describe("Electron tray strings (I3)", () => {
  it("maps OS locales onto the supported table with English fallback", () => {
    assert.equal(resolveTrayLocale("pt-BR"), "pt");
    assert.equal(resolveTrayLocale("pt"), "pt");
    assert.equal(resolveTrayLocale("pt_PT"), "pt");
    assert.equal(resolveTrayLocale("en-US"), "en");
    assert.equal(resolveTrayLocale("de-DE"), "en");
    assert.equal(resolveTrayLocale(""), "en");
    assert.equal(resolveTrayLocale(undefined), "en");
  });

  it("every key exists in every locale (no partial tray)", () => {
    const locales = Object.keys(TRAY_STRINGS);
    assert.ok(locales.includes("en") && locales.includes("pt"));
    const enKeys = Object.keys(TRAY_STRINGS.en).sort();
    for (const locale of locales) {
      assert.deepEqual(Object.keys(TRAY_STRINGS[locale]).sort(), enKeys, `locale ${locale}`);
    }
  });

  it("translates with interpolation and falls back to English for unknown keys", () => {
    const t = createTrayTranslator("pt-BR");
    assert.equal(t("openApp"), "Abrir OmniRoute");
    assert.equal(t("portLabel", { port: 20128 }), "Porta: 20128");
    assert.equal(t("updateReadyBody", { version: "3.8.51" }).includes("3.8.51"), true);
    const en = createTrayTranslator("fr");
    assert.equal(en("openApp"), "Open OmniRoute");
    assert.equal(en("nope.missing"), "nope.missing", "missing key returns the key itself");
  });
});
