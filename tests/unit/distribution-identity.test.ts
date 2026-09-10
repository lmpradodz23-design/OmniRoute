/**
 * Fase 8 — identity of the fork (audit/04 J15, audit/03 E-9).
 *
 * This repository is `LMPrado-DZ23/OmniRoute`. Before this lock, the update banner, the
 * Electron auto-updater, release downloads, the news/changelog feed, agent-skill sources and
 * every footer link still pointed at upstream (`diegosouzapw`): releases of this fork would
 * never be offered, and an upstream release would have been installed over it. The npm
 * package name is shared with upstream, so npm-sourced versions are trusted only when the
 * registry manifest points at this repository.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GHCR_IMAGE,
  GITHUB_OWNER,
  GITHUB_RELEASES_LATEST_API_URL,
  GITHUB_REPO_SLUG,
  GITHUB_REPO_URL,
  UPSTREAM_REPO_SLUG,
  isOurRepositoryUrl,
} from "../../src/shared/constants/distribution.ts";
import {
  getLatestVersionFromNpmCli,
  getLatestVersionFromRegistry,
} from "../../src/lib/system/versionCheck.ts";
import {
  AGENT_SKILLS_RAW_BASE,
  AGENT_SKILLS_BLOB_BASE,
} from "../../src/shared/constants/agentSkills.ts";
import { NEWS_JSON_URL, CHANGELOG_GITHUB_URL } from "../../src/shared/utils/releaseNotes.ts";
import { GITHUB_REPO_BLOB_URL } from "../../src/lib/docsLinkResolver.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("the distribution constants name this fork, and upstream is attribution only", () => {
  assert.equal(GITHUB_OWNER, "LMPrado-DZ23");
  assert.equal(GITHUB_REPO_SLUG, "LMPrado-DZ23/OmniRoute");
  assert.equal(GITHUB_REPO_URL, "https://github.com/LMPrado-DZ23/OmniRoute");
  assert.equal(
    GITHUB_RELEASES_LATEST_API_URL,
    "https://api.github.com/repos/LMPrado-DZ23/OmniRoute/releases/latest"
  );
  assert.equal(GHCR_IMAGE, "ghcr.io/lmprado-dz23/omniroute");
  assert.equal(UPSTREAM_REPO_SLUG, "diegosouzapw/OmniRoute");
});

test("every runtime URL derives from the constants (update banner, news, changelog, skills, docs)", () => {
  assert.ok(NEWS_JSON_URL.startsWith("https://raw.githubusercontent.com/LMPrado-DZ23/OmniRoute/"));
  assert.equal(CHANGELOG_GITHUB_URL, `${GITHUB_REPO_URL}/blob/main/CHANGELOG.md`);
  assert.equal(
    AGENT_SKILLS_RAW_BASE,
    "https://raw.githubusercontent.com/LMPrado-DZ23/OmniRoute/refs/heads/main/skills"
  );
  assert.equal(AGENT_SKILLS_BLOB_BASE, `${GITHUB_REPO_URL}/blob/main/skills`);
  assert.equal(GITHUB_REPO_BLOB_URL, `${GITHUB_REPO_URL}/blob/main`);
});

test("isOurRepositoryUrl accepts every npm spelling of this repo and rejects other forks", () => {
  for (const ok of [
    "https://github.com/LMPrado-DZ23/OmniRoute",
    "https://github.com/lmprado-dz23/omniroute.git",
    "git+https://github.com/LMPrado-DZ23/OmniRoute.git",
    "git+ssh://git@github.com/LMPrado-DZ23/OmniRoute.git",
    "git@github.com:LMPrado-DZ23/OmniRoute.git",
    "github:LMPrado-DZ23/OmniRoute",
    "  https://github.com/LMPrado-DZ23/OmniRoute/  ",
  ]) {
    assert.equal(isOurRepositoryUrl(ok), true, ok);
  }
  for (const bad of [
    "https://github.com/diegosouzapw/OmniRoute",
    "git+https://github.com/diegosouzapw/OmniRoute.git",
    "https://github.com/LMPrado-DZ23/OmniRoute-Enterprise",
    "https://gitlab.com/LMPrado-DZ23/OmniRoute",
    "",
    undefined,
    42,
  ]) {
    assert.equal(isOurRepositoryUrl(bad), false, String(bad));
  }
});

test("npm CLI version is ignored when the registry package is not published from this repository", async () => {
  const foreign = async () => ({
    stdout: JSON.stringify({
      version: "9.9.9",
      "repository.url": "git+https://github.com/diegosouzapw/OmniRoute.git",
    }),
    stderr: "",
  });
  assert.equal(await getLatestVersionFromNpmCli(foreign as never), null);

  const bareVersion = async () => ({ stdout: JSON.stringify("9.9.9"), stderr: "" });
  assert.equal(await getLatestVersionFromNpmCli(bareVersion as never), null, "unverifiable");

  const ours = async () => ({
    stdout: JSON.stringify({
      version: "3.9.0",
      "repository.url": "https://github.com/LMPrado-DZ23/OmniRoute",
    }),
    stderr: "",
  });
  assert.equal(await getLatestVersionFromNpmCli(ours as never), "3.9.0");
});

test("npm registry version is ignored unless its manifest repository is this repository", async () => {
  const respond = (body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

  assert.equal(
    await getLatestVersionFromRegistry(
      respond({
        version: "9.9.9",
        repository: { type: "git", url: "git+https://github.com/diegosouzapw/OmniRoute.git" },
      })
    ),
    null
  );
  assert.equal(await getLatestVersionFromRegistry(respond({ version: "9.9.9" })), null);
  assert.equal(
    await getLatestVersionFromRegistry(
      respond({
        version: "3.9.0",
        repository: { type: "git", url: "https://github.com/LMPrado-DZ23/OmniRoute" },
      })
    ),
    "3.9.0"
  );
});

test("the CLI updater applies the same gate (never installs another fork's npm package)", async () => {
  const update = await import("../../bin/cli/commands/update.mjs");
  const foreign = async () => ({
    stdout: JSON.stringify({
      version: "9.9.9",
      "repository.url": "git+https://github.com/diegosouzapw/OmniRoute.git",
    }),
  });
  assert.equal(await update.getLatestVersion(foreign), null);
  assert.equal(update.isOurRepositoryUrl("git@github.com:LMPrado-DZ23/OmniRoute.git"), true);
});

test("packaging and publish targets name this fork", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.repository.url, "https://github.com/LMPrado-DZ23/OmniRoute");
  assert.equal(pkg.author, "LMPrado-DZ23");

  const electron = JSON.parse(read("electron/package.json"));
  assert.deepEqual(electron.build.publish, {
    provider: "github",
    owner: "LMPrado-DZ23",
    repo: "OmniRoute",
  });

  for (const sub of [
    "@omniroute/opencode-plugin/package.json",
    "@omniroute/opencode-plugin-v2/package.json",
    "@omniroute/opencode-provider/package.json",
  ]) {
    assert.ok(!read(sub).includes("diegosouzapw"), `${sub} still points at upstream`);
  }

  assert.match(read(".github/CODEOWNERS"), /@LMPrado-DZ23/);
  assert.equal(fs.existsSync(path.join(repoRoot, ".github/FUNDING.yml")), false);
});

/** Runtime code must not carry the upstream owner outside comments / historical references. */
const RUNTIME_IDENTITY_FILES = [
  "src/lib/system/versionCheck.ts",
  "src/shared/utils/releaseNotes.ts",
  "src/shared/constants/agentSkills.ts",
  "src/lib/docsLinkResolver.ts",
  "src/app/(dashboard)/dashboard/HomePageClient.tsx",
  "src/shared/components/Footer.tsx",
  "src/app/landing/components/Footer.tsx",
  "src/app/landing/components/Navigation.tsx",
  "src/app/landing/components/HeroSection.tsx",
  "src/app/docs/layout.tsx",
  "src/shared/constants/sidebarVisibility/sections.ts",
  "src/app/(dashboard)/dashboard/agent-skills/components/SkillPreviewPane.tsx",
  "src/app/(dashboard)/dashboard/changelog/components/ChangelogViewer.tsx",
  "bin/cli/commands/update.mjs",
  "scripts/docs/sync-wiki.mjs",
];

test("no runtime identity file links to the upstream owner outside comments or issue references", () => {
  const offenders: string[] = [];
  for (const rel of RUNTIME_IDENTITY_FILES) {
    const lines = read(rel).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/diegosouzapw/i.test(line)) return;
      const trimmed = line.trim();
      const isComment = /^(\/\/|\*|\/\*|#|--)/.test(trimmed);
      const isHistoricalRef = /\/(issues|pull)\/\d+|OmniRoute#\d+/.test(line);
      if (!isComment && !isHistoricalRef) offenders.push(`${rel}:${index + 1}: ${trimmed}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
