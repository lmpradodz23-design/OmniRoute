import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseRelDistDir,
  siblingBuildDirExcludes,
} from "../../scripts/build/siblingBuildDirs.mjs";

// Tracing must exclude every OTHER build output under .build/ (they abort the build when another
// process rotates them mid-copy — verification builds #4/#7) but never the dist dir being built
// (that strips the bundle's own chunks — build #6).

const listed = () => [
  "next",
  "next-verify",
  "next-auditC2",
  "electron-standalone",
  "optional-packs",
];

test("excludes every sibling under .build/ and the current dist dir's dev cache, never the dist dir itself", () => {
  const excludes = siblingBuildDirExcludes("/repo", ".build/next-verify", listed);
  assert.deepEqual(excludes.sort(), [
    "**/.build/electron-standalone/**",
    "**/.build/next-auditC2/**",
    "**/.build/next-verify/dev/**",
    "**/.build/next/**",
    "**/.build/optional-packs/**",
  ]);
  assert.ok(!excludes.includes("**/.build/next-verify/**"));
  assert.ok(!excludes.includes("**/.build/**"));
});

test("the default dist dir keeps .build/next and excludes the verification / dev-server siblings", () => {
  const excludes = siblingBuildDirExcludes("/repo", ".build/next", listed);
  assert.ok(excludes.includes("**/.build/next-verify/**"));
  assert.ok(excludes.includes("**/.build/next-auditC2/**"));
  assert.ok(excludes.includes("**/.build/next/dev/**"));
  assert.ok(!excludes.includes("**/.build/next/**"));
});

test("absolute and backslash dist dirs normalise to the same relative form", () => {
  assert.equal(normaliseRelDistDir("C:\\repo\\.build\\next", "C:\\repo"), ".build/next");
  assert.equal(normaliseRelDistDir("./.build/next/", "/repo"), ".build/next");
  const a = siblingBuildDirExcludes("/repo", "/repo/.build/next", listed);
  const b = siblingBuildDirExcludes("/repo", ".build/next", listed);
  assert.deepEqual(a, b);
});

test("a dist dir outside .build/ (e.g. .next) excludes all of .build/", () => {
  assert.deepEqual(siblingBuildDirExcludes("/repo", ".next", listed), ["**/.build/**"]);
});

test("no .build/ directory yet → only the dev-cache exclude", () => {
  assert.deepEqual(
    siblingBuildDirExcludes("/repo", ".build/next", () => []),
    ["**/.build/next/dev/**"]
  );
});
