/**
 * E-4 guard (audit/RELEASE_READINESS.md): desktop code signing.
 *
 * v3.8.51 shipped UNSIGNED installers — SmartScreen warns on Windows and Gatekeeper
 * blocks the first launch on macOS. The certificates have to be bought/enrolled by the
 * owner, so the pipeline is wired to sign the moment the repository secrets exist and
 * to keep producing the unsigned build, green, while they do not.
 *
 * What this pins:
 *  1. secrets reach the workflow only through `env:` (or a reusable workflow's
 *     `secrets:`), never a `run:` body (zizmor template-injection);
 *  2. every signing secret is handed only to its own OS legs;
 *  3. the unsigned fallback: with every secret expanded to "" — what GitHub does for a
 *     missing secret — no signing variable reaches electron-builder and macOS turns
 *     identity auto-discovery off. That matters because app-builder-lib 26.15.3 treats
 *     an empty CSC_LINK as SET (platformPackager.getCscLink → chooseNotNull, `== null`);
 *  4. no secret value literal anywhere in the signing surface;
 *  5. hardened runtime + minimal entitlements, with notarization left env-driven.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

import {
  APPLE_API_KEY_KEYS,
  APPLE_ID_KEYS,
  AZURE_KEYS,
  MANAGED_KEYS,
  SIGNING_SECRETS,
  WIN_CERT_KEYS,
  decodeAppleApiKey,
  parseTarget,
  resolveElectronSigning,
} from "../../scripts/build/electron-signing.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), "utf8");

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};
type MatrixLeg = { platform: string; os: string; target: string };
type Job = {
  steps?: Step[];
  secrets?: Record<string, unknown>;
  strategy?: { matrix?: { include?: MatrixLeg[] } };
};
type Workflow = { jobs: Record<string, Job> };

const workflow = yaml.load(read(".github/workflows/electron-release.yml")) as Workflow;

/** The two macOS certificate secrets feed electron-builder variables with other names. */
const ENV_FOR_MAC_CERT_SECRET: Record<string, string> = {
  MAC_CSC_LINK: "CSC_LINK",
  MAC_CSC_KEY_PASSWORD: "CSC_KEY_PASSWORD",
};
const MAC_SECRET_FOR_ENV: Record<string, string> = {
  ...Object.fromEntries(Object.entries(ENV_FOR_MAC_CERT_SECRET).map(([s, e]) => [e, s])),
  ...Object.fromEntries([...APPLE_API_KEY_KEYS, ...APPLE_ID_KEYS].map((k) => [k, k])),
};
const WIN_SECRET_FOR_ENV: Record<string, string> = Object.fromEntries(
  [...WIN_CERT_KEYS, ...AZURE_KEYS].map((k) => [k, k])
);

/** Obviously fake values: used to prove forwarding AND that no message echoes a value. */
const FAKE: Record<string, string> = {
  CSC_LINK: "fake-p12-base64-for-tests",
  CSC_KEY_PASSWORD: "fake-p12-password-for-tests",
  APPLE_API_KEY_P8: "fake-p8-content-for-tests",
  APPLE_API_KEY_ID: "FAKEKEYID01",
  APPLE_API_ISSUER: "fake-issuer-for-tests",
  APPLE_ID: "fake-apple-id@example.invalid",
  APPLE_APP_SPECIFIC_PASSWORD: "fake-app-specific-password",
  APPLE_TEAM_ID: "FAKETEAM01",
  WIN_CSC_LINK: "fake-pfx-base64-for-tests",
  WIN_CSC_KEY_PASSWORD: "fake-pfx-password-for-tests",
  AZURE_TENANT_ID: "fake-tenant-for-tests",
  AZURE_CLIENT_ID: "fake-client-for-tests",
  AZURE_CLIENT_SECRET: "fake-client-secret-for-tests",
  AZURE_TRUSTED_SIGNING_ENDPOINT: "https://fake-endpoint.example.invalid",
  AZURE_TRUSTED_SIGNING_ACCOUNT: "fake-account-for-tests",
  AZURE_TRUSTED_SIGNING_PROFILE: "fake-profile-for-tests",
};
const pick = (keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, FAKE[k]]));

type SigningResult = ReturnType<typeof resolveElectronSigning>;

function assertNoValueEchoed(result: SigningResult): void {
  for (const line of [...result.info, ...result.warnings, ...result.errors]) {
    for (const value of Object.values(FAKE)) {
      assert.ok(!line.includes(value), `a signing message echoed a secret value: ${line}`);
    }
  }
}

function collectStrings(node: unknown, at = "", out: Array<[string, string]> = []) {
  if (typeof node === "string") out.push([at, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => collectStrings(v, `${at}.${i}`, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collectStrings(v, at ? `${at}.${k}` : k, out);
  }
  return out;
}

function buildSteps(): Step[] {
  const steps = workflow.jobs.build?.steps;
  assert.ok(Array.isArray(steps), "electron-release.yml must define build.steps");
  return steps;
}

function signingBuildStep(): Step {
  const step = buildSteps().find(
    (s) => typeof s.run === "string" && s.run.includes("electron-signing.mjs")
  );
  assert.ok(step, "the build job must package through scripts/build/electron-signing.mjs");
  return step;
}

test("secrets are referenced only via env: (or a reusable workflow's secrets:), never in run:", () => {
  const hits = collectStrings(workflow).filter(([, value]) => /\bsecrets\./.test(value));
  assert.ok(hits.length > 0, "sanity: the workflow does reference secrets");
  for (const [at] of hits) {
    const viaStepEnv = /^jobs\.[^.]+\.steps\.\d+\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(at);
    const viaReusableSecrets = /^jobs\.[^.]+\.secrets\.[A-Za-z_][A-Za-z0-9_]*$/.test(at);
    assert.ok(viaStepEnv || viaReusableSecrets, `secret referenced outside env:/secrets: at ${at}`);
  }
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== "string") continue;
      assert.doesNotMatch(step.run, /secrets\./, `${name} / ${step.name}: secret inside run:`);
    }
  }
});

test("each signing secret is handed only to its own OS legs, and the run body is expression-free", () => {
  const legs = workflow.jobs.build?.strategy?.matrix?.include ?? [];
  assert.deepEqual(
    legs.map((leg) => [leg.platform, leg.os]),
    [
      ["windows", "win32"],
      ["macos-intel", "darwin"],
      ["macos-arm64", "darwin"],
      ["linux", "linux"],
    ],
    "the per-OS gating below keys on matrix.os; if the matrix changes, revisit it"
  );

  const step = signingBuildStep();
  assert.equal(
    step.run?.trim(),
    'node ../.signing-helper/scripts/build/electron-signing.mjs --target "$BUILD_TARGET"'
  );
  assert.doesNotMatch(step.run ?? "", /\$\{\{/, "no expression may be interpolated into run:");

  const env = step.env ?? {};
  assert.equal(env.BUILD_TARGET, "${{ matrix.target }}");
  for (const [envName, secret] of Object.entries(MAC_SECRET_FOR_ENV)) {
    assert.equal(env[envName], `\${{ matrix.os == 'darwin' && secrets.${secret} || '' }}`);
  }
  for (const [envName, secret] of Object.entries(WIN_SECRET_FOR_ENV)) {
    assert.equal(env[envName], `\${{ matrix.os == 'win32' && secrets.${secret} || '' }}`);
  }

  const referenced = Object.values(env)
    .flatMap((v) => [...String(v).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))
    .filter((name) => name !== "GITHUB_TOKEN")
    .sort();
  assert.deepEqual(referenced, [...SIGNING_SECRETS].sort(), "exactly the documented secrets");
});

test("the signing helper comes from the workflow's own commit, so an older tag can be re-signed", () => {
  const steps = buildSteps();
  const index = steps.findIndex((s) => s.with?.path === ".signing-helper");
  assert.ok(index !== -1, "a sparse checkout of the helper must exist in the build job");
  const checkout = steps[index];
  assert.match(checkout.uses ?? "", /^actions\/checkout@[0-9a-f]{40}$/);
  assert.equal(checkout.with?.["persist-credentials"], false);
  assert.equal(
    Object.hasOwn(checkout.with ?? {}, "ref"),
    false,
    "no ref: — the build legs check out the TAG, which may predate the helper"
  );
  assert.match(String(checkout.with?.["sparse-checkout"]), /scripts\/build\/electron-signing\.mjs/);
  assert.ok(index < steps.indexOf(signingBuildStep()), "the helper must be checked out first");
});

test("every third-party action in the release workflow is pinned to a full commit SHA", () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.uses || step.uses.startsWith("./")) continue;
      assert.match(
        step.uses,
        /@[0-9a-f]{40}$/,
        `${name} / ${step.name ?? step.uses} is not SHA-pinned`
      );
    }
  }
});

test("no secret value literal anywhere in the signing surface", () => {
  const env = signingBuildStep().env ?? {};
  for (const key of MANAGED_KEYS) {
    if (!Object.hasOwn(env, key)) continue;
    assert.match(String(env[key]), /^\$\{\{[^}]*\}\}$/, `${key} must come from an expression`);
  }
  for (const rel of [
    ".github/workflows/electron-release.yml",
    "electron/package.json",
    "electron/assets/entitlements.mac.plist",
    "electron/assets/entitlements.mac.inherit.plist",
    "scripts/build/electron-signing.mjs",
    "docs/guides/ELECTRON_GUIDE.md",
  ]) {
    const text = read(rel);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{20,}/, rel);
    // A base64 PKCS#12/DER blob starts with "MII" and runs for kilobytes.
    assert.doesNotMatch(text, /MII[A-Za-z0-9+/]{200,}/, rel);
  }
  const build = JSON.parse(read("electron/package.json")).build;
  for (const key of ["cscLink", "cscKeyPassword", "cscInstallerLink", "cscInstallerKeyPassword"]) {
    assert.equal(Object.hasOwn(build, key), false, `build.${key} must not be committed`);
    assert.equal(
      Object.hasOwn(build.mac ?? {}, key),
      false,
      `build.mac.${key} must not be committed`
    );
    assert.equal(
      Object.hasOwn(build.win ?? {}, key),
      false,
      `build.win.${key} must not be committed`
    );
  }
});

test("without secrets every leg builds unsigned, exactly as before E-4", () => {
  // GitHub expands a missing secret to "", so the helper sees every key set to "".
  const emptySecrets = Object.fromEntries(MANAGED_KEYS.map((k) => [k, ""]));
  const base = { ...emptySecrets, PATH: "/usr/bin", GH_TOKEN: "not-a-signing-secret" };

  const mac = resolveElectronSigning({ platform: "darwin", env: base });
  assert.equal(mac.signing, "disabled");
  assert.deepEqual([mac.errors, mac.warnings], [[], []]);
  assert.equal(mac.childEnv.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  for (const key of MANAGED_KEYS.filter((k) => k !== "CSC_IDENTITY_AUTO_DISCOVERY")) {
    assert.equal(Object.hasOwn(mac.childEnv, key), false, `darwin: empty ${key} must be deleted`);
  }
  assert.ok(
    mac.info.some((l: string) => l.startsWith("signing: disabled (missing secret MAC_CSC_LINK)"))
  );
  assert.equal(mac.childEnv.GH_TOKEN, "not-a-signing-secret", "unrelated env is preserved");

  const win = resolveElectronSigning({ platform: "win32", env: base });
  assert.equal(win.signing, "disabled");
  assert.deepEqual([win.errors, win.warnings], [[], []]);
  for (const key of MANAGED_KEYS) {
    assert.equal(Object.hasOwn(win.childEnv, key), false, `win32: empty ${key} must be deleted`);
  }
  assert.ok(
    win.info.some((l: string) => l.startsWith("signing: disabled (missing secret WIN_CSC_LINK"))
  );
  assert.equal(win.azureSignOptions, null);

  const linux = resolveElectronSigning({ platform: "linux", env: { ...base, ...FAKE } });
  assert.equal(linux.signing, "not-applicable");
  for (const key of MANAGED_KEYS) assert.equal(Object.hasOwn(linux.childEnv, key), false);

  const whitespace = resolveElectronSigning({ platform: "darwin", env: { CSC_LINK: "  \n" } });
  assert.equal(whitespace.signing, "disabled", "a whitespace-only secret counts as missing");
});

test("macOS signs with the certificate and prefers the App Store Connect API key for notarization", () => {
  const env = { ...FAKE, CSC_IDENTITY_AUTO_DISCOVERY: "false", PATH: "/usr/bin" };
  const r = resolveElectronSigning({ platform: "darwin", env });
  assert.deepEqual(
    [r.signing, r.method, r.notarization],
    ["enabled", "developer-id-certificate", "app-store-connect-api-key"]
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.childEnv.CSC_LINK, FAKE.CSC_LINK);
  assert.equal(r.childEnv.CSC_KEY_PASSWORD, FAKE.CSC_KEY_PASSWORD);
  assert.equal(
    Object.hasOwn(r.childEnv, "CSC_IDENTITY_AUTO_DISCOVERY"),
    false,
    'auto-discovery "false" + CSC_LINK makes electron-builder find no identity and skip signing'
  );
  assert.equal(r.appleApiKeyContent, FAKE.APPLE_API_KEY_P8);
  assert.equal(Object.hasOwn(r.childEnv, "APPLE_API_KEY_P8"), false, "the .p8 goes to a file");
  assert.equal(r.childEnv.APPLE_API_KEY_ID, FAKE.APPLE_API_KEY_ID);
  for (const key of [...APPLE_ID_KEYS, ...WIN_CERT_KEYS, ...AZURE_KEYS]) {
    assert.equal(Object.hasOwn(r.childEnv, key), false, `${key} must not reach the mac build`);
  }
  assertNoValueEchoed(r);

  const appleId = resolveElectronSigning({
    platform: "darwin",
    env: { ...pick(["CSC_LINK", "CSC_KEY_PASSWORD"]), ...pick(APPLE_ID_KEYS) },
  });
  assert.equal(appleId.notarization, "apple-id");
  assert.equal(appleId.childEnv.APPLE_TEAM_ID, FAKE.APPLE_TEAM_ID);

  const certOnly = resolveElectronSigning({
    platform: "darwin",
    env: pick(["CSC_LINK", "CSC_KEY_PASSWORD"]),
  });
  assert.deepEqual(
    [certOnly.signing, certOnly.notarization, certOnly.errors],
    ["enabled", null, []]
  );
  assert.ok(certOnly.warnings.some((w: string) => w.startsWith("notarization: disabled")));
});

test("a partial credential set fails loudly and names only the missing secrets", () => {
  const partialApiKey = resolveElectronSigning({
    platform: "darwin",
    env: { ...pick(["CSC_LINK", "CSC_KEY_PASSWORD"]), APPLE_API_KEY_ID: FAKE.APPLE_API_KEY_ID },
  });
  assert.equal(partialApiKey.errors.length, 1);
  assert.match(partialApiKey.errors[0], /missing secret\(s\) APPLE_API_KEY_P8, APPLE_API_ISSUER$/);
  assertNoValueEchoed(partialApiKey);

  const partialAppleId = resolveElectronSigning({
    platform: "darwin",
    env: { ...pick(["CSC_LINK"]), APPLE_ID: FAKE.APPLE_ID },
  });
  assert.match(
    partialAppleId.errors[0],
    /missing secret\(s\) APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID$/
  );
  assertNoValueEchoed(partialAppleId);

  const partialAzure = resolveElectronSigning({
    platform: "win32",
    env: pick(["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"]),
  });
  assert.match(
    partialAzure.errors[0],
    /missing secret\(s\) AZURE_TRUSTED_SIGNING_ENDPOINT, AZURE_TRUSTED_SIGNING_ACCOUNT, AZURE_TRUSTED_SIGNING_PROFILE$/
  );
  assertNoValueEchoed(partialAzure);
});

test("Windows signs with Azure Trusted Signing when complete, else with the Authenticode certificate", () => {
  const azure = resolveElectronSigning({ platform: "win32", env: { ...FAKE } });
  assert.deepEqual(
    [azure.signing, azure.method, azure.errors],
    ["enabled", "azure-trusted-signing", []]
  );
  assert.deepEqual(azure.azureSignOptions, {
    endpoint: FAKE.AZURE_TRUSTED_SIGNING_ENDPOINT,
    codeSigningAccountName: FAKE.AZURE_TRUSTED_SIGNING_ACCOUNT,
    certificateProfileName: FAKE.AZURE_TRUSTED_SIGNING_PROFILE,
  });
  assert.equal(azure.childEnv.AZURE_CLIENT_SECRET, FAKE.AZURE_CLIENT_SECRET);
  for (const key of [
    ...WIN_CERT_KEYS,
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    ...APPLE_API_KEY_KEYS,
    ...APPLE_ID_KEYS,
  ]) {
    assert.equal(
      Object.hasOwn(azure.childEnv, key),
      false,
      `${key} must not reach the Azure build`
    );
  }
  assertNoValueEchoed(azure);

  const cert = resolveElectronSigning({
    platform: "win32",
    env: { ...pick(WIN_CERT_KEYS), ...pick(["CSC_LINK", "CSC_KEY_PASSWORD"]) },
  });
  assert.deepEqual(
    [cert.signing, cert.method, cert.azureSignOptions],
    ["enabled", "authenticode-certificate", null]
  );
  assert.equal(cert.childEnv.WIN_CSC_LINK, FAKE.WIN_CSC_LINK);
  assert.equal(
    Object.hasOwn(cert.childEnv, "CSC_LINK"),
    false,
    "winPackager falls back to CSC_LINK — the mac certificate must never reach Windows"
  );
  assertNoValueEchoed(cert);
});

test("helper inputs are validated: build target allowlist and the .p8 encoding", () => {
  assert.equal(parseTarget(["--target", "mac-arm64"]), "mac-arm64");
  for (const bad of [[], ["--target"], ["--target", "win && calc"], ["--target", "mas"]]) {
    assert.throws(() => parseTarget(bad), /--target must be one of/);
  }

  const pem = ["-----BEGIN PRIVATE", "KEY-----\nZmFrZQ==\n-----END PRIVATE", "KEY-----"].join(" ");
  assert.equal(decodeAppleApiKey(pem), `${pem}\n`);
  assert.equal(decodeAppleApiKey(Buffer.from(pem).toString("base64")), `${pem}\n`);
  assert.throws(() => decodeAppleApiKey("not a key"), /neither a PEM/);
});

test("macOS uses the hardened runtime with minimal entitlements; notarization stays env-driven", () => {
  const build = JSON.parse(read("electron/package.json")).build;
  const mac = build.mac;
  assert.equal(mac.hardenedRuntime, true);
  assert.equal(mac.entitlements, "assets/entitlements.mac.plist");
  assert.equal(mac.entitlementsInherit, "assets/entitlements.mac.inherit.plist");
  // `notarize: false` would disable notarization even with credentials; `identity: null`
  // or `forceCodeSigning: true` would break the unsigned fallback.
  for (const key of ["notarize", "identity", "forceCodeSigning"]) {
    assert.equal(Object.hasOwn(mac, key), false, `build.mac.${key} must stay unset`);
  }
  // A static azureSignOptions makes every Windows build try Azure, with or without secrets.
  for (const key of ["azureSignOptions", "signtoolOptions"]) {
    assert.equal(Object.hasOwn(build.win, key), false, `build.win.${key} must stay unset`);
  }

  const keys = (rel: string) =>
    [
      ...read(rel)
        .replace(/<!--[\s\S]*?-->/g, "")
        .matchAll(/<key>([^<]+)<\/key>/g),
    ]
      .map((m) => m[1])
      .sort();
  assert.deepEqual(keys("electron/assets/entitlements.mac.plist"), [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
  ]);
  assert.deepEqual(keys("electron/assets/entitlements.mac.inherit.plist"), [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
  ]);
});

test("the owner documentation lists every secret and the re-attach command", () => {
  const guide = read("docs/guides/ELECTRON_GUIDE.md");
  for (const secret of SIGNING_SECRETS) {
    assert.ok(guide.includes(`\`${secret}\``), `ELECTRON_GUIDE.md must document ${secret}`);
  }
  assert.ok(
    guide.includes(
      "gh workflow run electron-release.yml --ref release/v3.8.51 -f version=v3.8.51 -f publish_npm=false"
    )
  );
  // …and must not promise that re-running it ships newer code: the build checks out the tag.
  assert.match(guide, /re-attaches assets built from the code at the version tag/);
  assert.match(guide, /new\s+version tag\*\*, e\.g\. `v3\.8\.52`/);
  assert.match(
    read("audit/RELEASE_READINESS.md"),
    /\| E-4 code-signing Electron\s*\|[^\n]*pipeline pronto/
  );
});

test("every build job checks out the version TAG, and the dispatch comment says so", () => {
  // A dispatch rebuilds the code AT the version tag, not the dispatched ref. Run
  // 34710550989 (dispatched from release/v3.8.51) still built tag v3.8.51 on every leg.
  // The old header comment claimed the opposite; this keeps comment and behaviour in sync.
  for (const jobName of ["web-build", "build", "release"]) {
    const sourceCheckouts = (workflow.jobs[jobName]?.steps ?? []).filter(
      (s) => (s.uses ?? "").startsWith("actions/checkout@") && s.with?.path !== ".signing-helper"
    );
    assert.equal(sourceCheckouts.length, 1, `${jobName} must have exactly one source checkout`);
    assert.equal(
      sourceCheckouts[0].with?.ref,
      "${{ needs.validate.outputs.version }}",
      `${jobName} must build the version tag, not the dispatch ref`
    );
  }

  const raw = read(".github/workflows/electron-release.yml");
  const header = raw.slice(0, raw.search(/^jobs:/m));
  assert.doesNotMatch(header, /A dispatch builds the ref it is dispatched ON/i);
  assert.match(header, /A dispatch does NOT build the ref it is dispatched on/);
  assert.match(header, /new version tag/);
});

test("the helper keeps CI-only names out of the product env contract", () => {
  // scripts/check/check-env-doc-sync.mjs greps scripts/ for the process-env member
  // syntax and would demand .env.example entries for these CI-only names.
  assert.doesNotMatch(read("scripts/build/electron-signing.mjs"), /process\.env\.[A-Z]/);
});
