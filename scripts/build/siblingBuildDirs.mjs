/**
 * Output-file-tracing excludes for the OTHER build outputs under `.build/`.
 *
 * Next's tracer emits the whole project root for this app, so every sibling dist dir (a
 * verification build in `.build/next-verify`, a dev server's `.build/next-<x>/dev`, the Electron
 * staging copy, optional packs) is traced into the standalone — and a sibling that is being
 * written or rotated by another process makes `next build` abort with ENOENT while copying
 * (verification builds #4 and #7 of the v3.8.51 audit). The dist dir being built must NOT be
 * excluded (that strips the bundle's own chunks — build #6). So the list is computed at config
 * time: every directory under `.build/` except the current dist dir, plus that dist dir's own
 * `dev/` cache (a dev server writing there while the same dist dir is built).
 */
import fs from "node:fs";
import path from "node:path";

/** Normalise a dist dir like `.build\next`, `./.build/next` or `/abs/.build/next` → `.build/next`. */
export function normaliseRelDistDir(distDir, projectRoot) {
  // Backslash paths must normalise identically on every host: a Windows-style dist dir is
  // still absolute when the gate runs on the Linux CI runner (where `path` is posix).
  const dist = toForwardSlashes(distDir);
  const root = toForwardSlashes(projectRoot);
  let rel = dist;
  if (path.win32.isAbsolute(dist) || path.posix.isAbsolute(dist)) {
    rel = dist.startsWith(`${root}/`)
      ? dist.slice(root.length + 1)
      : path.posix.relative(root, dist);
  }
  return rel.replace(/^\.\//, "").replace(/\/+$/, "");
}

function toForwardSlashes(p) {
  return String(p).replaceAll("\\", "/").replace(/\/+$/, "");
}

/**
 * @param {string} projectRoot
 * @param {string} distDir current dist dir (relative or absolute)
 * @param {(dir: string) => string[]} [listDirs] test seam: names of directories under `.build/`
 * @returns {string[]} globs for `outputFileTracingExcludes`
 */
export function siblingBuildDirExcludes(projectRoot, distDir, listDirs = defaultListDirs) {
  const relDistDir = normaliseRelDistDir(distDir, projectRoot);
  const [top, sub] = relDistDir.split("/");
  const excludes = [];
  if (top !== ".build") {
    // The dist dir lives elsewhere (e.g. `.next`): nothing under `.build/` is runtime.
    excludes.push("**/.build/**");
  } else {
    for (const name of listDirs(path.join(projectRoot, ".build"))) {
      if (name !== sub) excludes.push(`**/.build/${name}/**`);
    }
    // A dev server of the SAME dist dir writes to <distDir>/dev — never a production asset.
    excludes.push(`**/${relDistDir}/dev/**`);
  }
  return excludes;
}

function defaultListDirs(buildRoot) {
  try {
    return fs
      .readdirSync(buildRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
