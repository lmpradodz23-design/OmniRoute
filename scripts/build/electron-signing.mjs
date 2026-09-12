#!/usr/bin/env node
// scripts/build/electron-signing.mjs
//
// Code signing for the desktop release (audit/RELEASE_READINESS.md E-4).
//
// `.github/workflows/electron-release.yml` hands the signing secrets to this script
// through the build step's `env:` only, then runs (from electron/, with this file
// sparse-checked-out from the workflow's own commit into .signing-helper/):
//
//   node ../.signing-helper/scripts/build/electron-signing.mjs --target <win|mac-x64|mac-arm64|linux>
//
// The script decides per leg whether to sign, prints one "signing: ..." line (secret
// NAMES only, never values), and runs `npm run build:<target>` with a sanitised
// environment. No secrets -> unsigned build, identical to the pipeline before E-4.
//
// Why a sanitised child env instead of passing the secrets straight through
// (verified against app-builder-lib 26.15.3, the version pinned in
// electron/package-lock.json):
//
// - A missing GitHub secret expands to "" (empty string), not "unset".
//   platformPackager.getCscLink() picks the link with chooseNotNull (`v == null`), so
//   an empty link counts as SET, and macPackager.codeSigningInfo only skips keychain
//   creation when the link `== null`. Empty is not absent on macOS, so every empty
//   managed variable is deleted instead of forwarded.
// - util/flags.isAutoDiscoveryCodeSignIdentity() is `!== "false"`. Unsigned mac legs
//   set it to "false" so electron-builder does not scan the runner's keychains. It
//   must NOT be "false" when a certificate is present: macCodeSign.findIdentity then
//   returns null and the build silently stays unsigned.
// - mac/MacTargetHelper.getNotarizeOptions() throws on a partial Apple ID or API-key
//   set. This script reports a partial configuration itself, naming the missing
//   secrets, instead of an electron-builder stack trace mid-build.
// - APPLE_API_KEY must be a FILE PATH to the .p8 (@electron/notarize 2.5.0 passes it
//   to `notarytool --key`), so the secret content is written to a 0600 temp file that
//   is removed after the build.
// - A `win.azureSignOptions` block switches winPackager to the Azure manager
//   unconditionally (it installs the TrustedSigning PowerShell module and signs), so it
//   cannot live in electron/package.json. It is added to the CI checkout's copy only
//   when the Azure set is complete, and the original file is restored afterwards.
//
// Individual variables are read from an env object by key, driven by the constant
// lists below, never through the process-env member syntax: these CI-only names are
// not product configuration (scripts/check/check-env-doc-sync.mjs).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** npm script suffix (electron/package.json `build:<target>`) -> runner platform. */
export const BUILD_TARGETS = Object.freeze({
  win: "win32",
  "mac-x64": "darwin",
  "mac-arm64": "darwin",
  linux: "linux",
});

export const MAC_CERT_KEYS = Object.freeze(["CSC_LINK", "CSC_KEY_PASSWORD"]);
export const APPLE_ID_KEYS = Object.freeze([
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
]);
export const APPLE_API_KEY_KEYS = Object.freeze([
  "APPLE_API_KEY_P8",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
]);
export const WIN_CERT_KEYS = Object.freeze(["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]);
export const AZURE_CREDENTIAL_KEYS = Object.freeze([
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
]);
export const AZURE_ACCOUNT_KEYS = Object.freeze([
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT",
  "AZURE_TRUSTED_SIGNING_PROFILE",
]);
export const AZURE_KEYS = Object.freeze([...AZURE_CREDENTIAL_KEYS, ...AZURE_ACCOUNT_KEYS]);

/**
 * Variables electron-builder would act on that this script derives itself or keeps
 * out of the child: never inherited from the runner.
 */
const DERIVED_KEYS = Object.freeze([
  "APPLE_API_KEY",
  "APPLE_KEYCHAIN",
  "APPLE_KEYCHAIN_PROFILE",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "CSC_NAME",
  "CSC_INSTALLER_LINK",
  "CSC_INSTALLER_KEY_PASSWORD",
]);

export const MANAGED_KEYS = Object.freeze([
  ...MAC_CERT_KEYS,
  ...APPLE_ID_KEYS,
  ...APPLE_API_KEY_KEYS,
  ...WIN_CERT_KEYS,
  ...AZURE_KEYS,
  ...DERIVED_KEYS,
]);

/** Repository secret feeding each electron-builder variable whose name differs. */
const SECRET_FOR = Object.freeze({
  CSC_LINK: "MAC_CSC_LINK",
  CSC_KEY_PASSWORD: "MAC_CSC_KEY_PASSWORD",
});

/** Every repository secret the owner may create. Pinned by the workflow guard test and the docs. */
export const SIGNING_SECRETS = Object.freeze([
  "MAC_CSC_LINK",
  "MAC_CSC_KEY_PASSWORD",
  ...APPLE_API_KEY_KEYS,
  ...APPLE_ID_KEYS,
  ...WIN_CERT_KEYS,
  ...AZURE_KEYS,
]);

const secretName = (key) => SECRET_FOR[key] ?? key;
const listSecrets = (keys) => keys.map(secretName).join(", ");

/**
 * Decide how one leg signs. Pure: no I/O, and no secret value in any returned message.
 *
 * @param {{ platform: string, env: Record<string, string | undefined> }} input
 */
export function resolveElectronSigning({ platform, env }) {
  const present = (key) => typeof env[key] === "string" && env[key].trim() !== "";
  const missing = (keys) => keys.filter((key) => !present(key));
  const childEnv = { ...env };
  for (const key of MANAGED_KEYS) delete childEnv[key];
  const forward = (keys) => {
    for (const key of keys) if (present(key)) childEnv[key] = env[key];
  };

  const result = {
    platform,
    /** @type {"enabled" | "disabled" | "not-applicable"} */
    signing: "disabled",
    /** @type {null | "developer-id-certificate" | "authenticode-certificate" | "azure-trusted-signing"} */
    method: null,
    /** @type {null | "app-store-connect-api-key" | "apple-id"} */
    notarization: null,
    /** @type {string[]} */
    info: [],
    /** @type {string[]} */
    warnings: [],
    /** @type {string[]} */
    errors: [],
    childEnv,
    /** @type {string | null} */
    appleApiKeyContent: null,
    /** @type {null | { endpoint: string, codeSigningAccountName: string, certificateProfileName: string }} */
    azureSignOptions: null,
  };

  if (platform === "darwin") {
    if (!present("CSC_LINK")) {
      childEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
      result.info.push(
        "signing: disabled (missing secret MAC_CSC_LINK) — building an unsigned app"
      );
      result.info.push("notarization: disabled (requires a signed app)");
      return result;
    }
    forward(MAC_CERT_KEYS);
    result.signing = "enabled";
    result.method = "developer-id-certificate";
    result.info.push("signing: enabled (Developer ID Application certificate from MAC_CSC_LINK)");
    if (!present("CSC_KEY_PASSWORD")) {
      result.warnings.push(
        "MAC_CSC_KEY_PASSWORD is empty — electron-builder will import the certificate with an empty password"
      );
    }

    const apiAny = APPLE_API_KEY_KEYS.some(present);
    const idAny = APPLE_ID_KEYS.some(present);
    const apiMissing = missing(APPLE_API_KEY_KEYS);
    const idMissing = missing(APPLE_ID_KEYS);
    if (apiAny && apiMissing.length > 0) {
      result.errors.push(
        `notarization: incomplete App Store Connect API key — missing secret(s) ${listSecrets(apiMissing)}`
      );
    }
    if (idAny && idMissing.length > 0) {
      result.errors.push(
        `notarization: incomplete Apple ID credentials — missing secret(s) ${listSecrets(idMissing)}`
      );
    }
    if (result.errors.length > 0) return result;

    if (apiAny) {
      forward(["APPLE_API_KEY_ID", "APPLE_API_ISSUER"]);
      result.appleApiKeyContent = env.APPLE_API_KEY_P8 ?? null;
      result.notarization = "app-store-connect-api-key";
      result.info.push("notarization: enabled (App Store Connect API key)");
      if (idAny) {
        result.info.push(
          "notarization: the Apple ID secrets are also set and are ignored in favour of the API key"
        );
      }
    } else if (idAny) {
      forward(APPLE_ID_KEYS);
      result.notarization = "apple-id";
      result.info.push("notarization: enabled (Apple ID + app-specific password)");
    } else {
      result.warnings.push(
        `notarization: disabled (missing secrets ${listSecrets(APPLE_API_KEY_KEYS)} or ${listSecrets(APPLE_ID_KEYS)}) — ` +
          "the app is signed but not notarized, so Gatekeeper still blocks the first launch"
      );
    }
    return result;
  }

  if (platform === "win32") {
    const azureAny = AZURE_KEYS.some(present);
    const azureMissing = missing(AZURE_KEYS);
    if (azureAny && azureMissing.length > 0) {
      result.errors.push(
        `signing: incomplete Azure Trusted Signing configuration — missing secret(s) ${listSecrets(azureMissing)}`
      );
      return result;
    }
    if (azureAny) {
      forward(AZURE_CREDENTIAL_KEYS);
      result.signing = "enabled";
      result.method = "azure-trusted-signing";
      result.azureSignOptions = {
        endpoint: String(env.AZURE_TRUSTED_SIGNING_ENDPOINT).trim(),
        codeSigningAccountName: String(env.AZURE_TRUSTED_SIGNING_ACCOUNT).trim(),
        certificateProfileName: String(env.AZURE_TRUSTED_SIGNING_PROFILE).trim(),
      };
      result.info.push("signing: enabled (Azure Trusted Signing)");
      if (present("WIN_CSC_LINK")) {
        result.info.push(
          "signing: WIN_CSC_LINK is also set and is ignored — Azure Trusted Signing takes precedence"
        );
      }
      return result;
    }
    if (present("WIN_CSC_LINK")) {
      forward(WIN_CERT_KEYS);
      result.signing = "enabled";
      result.method = "authenticode-certificate";
      result.info.push("signing: enabled (Authenticode certificate from WIN_CSC_LINK)");
      if (!present("WIN_CSC_KEY_PASSWORD")) {
        result.warnings.push(
          "WIN_CSC_KEY_PASSWORD is empty — electron-builder will import the certificate with an empty password"
        );
      }
      return result;
    }
    result.info.push(
      `signing: disabled (missing secret WIN_CSC_LINK, or the Azure Trusted Signing set ${listSecrets(AZURE_KEYS)}) — building an unsigned installer`
    );
    return result;
  }

  if (platform === "linux") {
    result.signing = "not-applicable";
    result.info.push("signing: not applicable (AppImage/deb are not code-signed by this pipeline)");
    return result;
  }

  result.errors.push(`signing: unsupported platform ${platform}`);
  return result;
}

/**
 * The APPLE_API_KEY_P8 secret holds the .p8 key itself: the PEM text verbatim, or a
 * base64 encoding of it (what `base64 -i AuthKey_XXXX.p8` prints).
 *
 * @param {string} content
 * @returns {string}
 */
export function decodeAppleApiKey(content) {
  const raw = String(content ?? "").trim();
  if (raw.includes("-----BEGIN")) return `${raw}\n`;
  const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
  if (!decoded.includes("-----BEGIN")) {
    throw new Error("APPLE_API_KEY_P8 is neither a PEM .p8 key nor base64 of one");
  }
  return `${decoded}\n`;
}

/**
 * @param {string[]} argv
 * @returns {string}
 */
export function parseTarget(argv) {
  const index = argv.indexOf("--target");
  const target = index === -1 ? undefined : argv[index + 1];
  if (!target || !Object.hasOwn(BUILD_TARGETS, target)) {
    throw new Error(`--target must be one of: ${Object.keys(BUILD_TARGETS).join(", ")}`);
  }
  return target;
}

function report(result, inActions) {
  for (const line of result.info) console.log(`[electron-signing] ${line}`);
  for (const line of result.warnings) {
    console.log(
      inActions ? `::warning title=Electron signing::${line}` : `[electron-signing] WARNING ${line}`
    );
  }
  for (const line of result.errors) {
    console.log(
      inActions ? `::error title=Electron signing::${line}` : `[electron-signing] ERROR ${line}`
    );
  }
}

function main() {
  const target = parseTarget(process.argv.slice(2));
  const expectedPlatform = BUILD_TARGETS[target];
  if (process.platform !== expectedPlatform) {
    throw new Error(`build:${target} must run on ${expectedPlatform}, not ${process.platform}`);
  }

  const env = process.env;
  const result = resolveElectronSigning({ platform: process.platform, env });
  report(result, env.GITHUB_ACTIONS === "true");
  if (result.errors.length > 0) return 1;

  const cleanups = [];
  try {
    if (result.appleApiKeyContent) {
      const dir = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), "omniroute-notary-"));
      cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
      const keyFile = path.join(dir, "AuthKey.p8");
      fs.writeFileSync(keyFile, decodeAppleApiKey(result.appleApiKeyContent), { mode: 0o600 });
      result.childEnv.APPLE_API_KEY = keyFile;
    }

    if (result.azureSignOptions) {
      const pkgPath = path.resolve("package.json");
      const original = fs.readFileSync(pkgPath, "utf8");
      const pkg = JSON.parse(original);
      if (pkg.name !== "omniroute-desktop") {
        throw new Error(`refusing to patch ${pkgPath}: run this script from electron/`);
      }
      pkg.build.win = { ...pkg.build.win, azureSignOptions: result.azureSignOptions };
      cleanups.push(() => fs.writeFileSync(pkgPath, original));
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }

    // Fixed command built from an allowlisted target; no environment value is
    // interpolated. A shell is used on Windows only, where npm is npm.cmd and Node
    // refuses to spawn .cmd files without one (CVE-2024-27980).
    const child =
      process.platform === "win32"
        ? spawnSync(`npm run build:${target}`, {
            stdio: "inherit",
            env: result.childEnv,
            shell: true,
          })
        : spawnSync("npm", ["run", `build:${target}`], { stdio: "inherit", env: result.childEnv });
    if (child.error) throw child.error;
    return child.status ?? 1;
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`[electron-signing] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
