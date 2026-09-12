/**
 * Distribution identity — the single source of truth for WHERE this build comes from and
 * where its updates, releases, docs and skills live (Fase 8 of the readiness audit).
 *
 * This repository is the maintained fork `LMPrado-DZ23/OmniRoute`. Everything that talks
 * to "the project's GitHub" (update banner, release downloads, news feed, changelog,
 * agent-skill sources, footer links) must derive from these constants, never from a
 * hard-coded owner — otherwise updates and downloads silently point at another fork.
 *
 * Upstream (`diegosouzapw/OmniRoute`) is kept ONLY for attribution and for historical
 * issue/PR references in comments and the changelog.
 */

export const GITHUB_OWNER = "LMPrado-DZ23";
export const GITHUB_REPO = "OmniRoute";
export const GITHUB_REPO_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_SLUG}`;
export const GITHUB_RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO_SLUG}`;
export const GITHUB_RELEASES_LATEST_API_URL = `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`;
export const DEFAULT_BRANCH = "main";

/** Original project this fork descends from — attribution only. */
export const UPSTREAM_REPO_SLUG = "diegosouzapw/OmniRoute";

/**
 * npm package name this build ships under. The public `omniroute` package on npmjs.com is
 * published by upstream; this fork is distributed through GitHub releases and GHCR. Any
 * npm-based "latest version" lookup must therefore verify that the registry package really
 * points at THIS repository (`isOurRepositoryUrl`) before trusting it — otherwise the update
 * banner and `omniroute update` would advertise (and install) another fork's build.
 */
export const NPM_PACKAGE_NAME = "omniroute";

/** Container image (GHCR, lowercase as the registry requires). */
export const GHCR_IMAGE = `ghcr.io/${GITHUB_OWNER.toLowerCase()}/${GITHUB_REPO.toLowerCase()}`;

/**
 * True when a package `repository.url` (any of the git+https / ssh / shorthand spellings
 * npm accepts) resolves to this repository.
 */
export function isOurRepositoryUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const normalized = url
    .trim()
    .toLowerCase()
    .replace(/^git\+/, "")
    .replace(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?/, "")
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/^github:/, "github.com/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return normalized === `github.com/${GITHUB_REPO_SLUG.toLowerCase()}`;
}
