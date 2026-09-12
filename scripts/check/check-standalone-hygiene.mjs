#!/usr/bin/env node
/**
 * check:standalone-hygiene — the release gate for X-1 (final audit).
 *
 * Next's output-file tracing emits the whole project root for this app, so a standalone
 * bundle can end up carrying the checkout's secrets and non-runtime trees. The build script
 * prunes them (STANDALONE_PRUNE_TARGETS); this gate proves the RESULT on disk, for the
 * standalone itself and — when present — the Electron staging copy / packaged app:
 *
 *   node scripts/check/check-standalone-hygiene.mjs [--dist .build/next] [--dir <extra bundle dir>]...
 *
 * Exit 1 with a list of offenders when any of these is found:
 *   - a denylisted top-level entry (STANDALONE_PRUNE_TARGETS, plus .next / sibling dist dirs);
 *   - anywhere outside node_modules: an env file (.env, .env.*, server.env — .env.example is
 *     allowed), a SQLite database or its WAL/SHM, a private key / certificate bundle, server.pid;
 *   - the bundle's own dist dir without a server/ directory (an unbootable standalone).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STANDALONE_PRUNE_TARGETS } from "../build/build-next-isolated.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

export const FORBIDDEN_FILE_PATTERNS = [
  { name: "env file", test: (base) => /^\.env(\..+)?$/.test(base) && !/\.example$/.test(base) },
  { name: "server.env", test: (base) => base === "server.env" },
  {
    name: "sqlite database",
    test: (base) => /\.(sqlite|sqlite3|db)(-wal|-shm|-journal)?$/i.test(base),
  },
  { name: "private key / cert bundle", test: (base) => /\.(pem|key|pfx|p12)$/i.test(base) },
  { name: "server.pid", test: (base) => base === "server.pid" },
  { name: "npmrc (may carry an auth token)", test: (base) => base === ".npmrc" },
];

function* walk(dir, rel = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walk(path.join(dir, entry.name), relPath);
    } else {
      yield { relPath, base: entry.name };
    }
  }
}

/** Pure check: returns the list of offenders (empty = clean). */
export function auditBundle(bundleRoot, { relDistDir = ".build/next" } = {}) {
  const offenders = [];
  if (!fs.existsSync(bundleRoot)) return [`bundle root missing: ${bundleRoot}`];

  for (const rel of STANDALONE_PRUNE_TARGETS) {
    if (fs.existsSync(path.join(bundleRoot, rel)))
      offenders.push(`denylisted entry present: ${rel}`);
  }
  const distParts = relDistDir.replaceAll("\\", "/").replace(/^\.\//, "").split("/");
  const [distTop, distSub] = distParts;
  if (distTop !== ".next" && fs.existsSync(path.join(bundleRoot, ".next"))) {
    offenders.push("foreign dist dir present: .next");
  }
  const buildDir = path.join(bundleRoot, ".build");
  if (fs.existsSync(buildDir)) {
    for (const entry of fs.readdirSync(buildDir)) {
      if (distTop === ".build" && entry === distSub) continue;
      offenders.push(`foreign dist dir present: .build/${entry}`);
    }
  }
  const ownServer = path.join(bundleRoot, ...distParts, "server");
  if (!fs.existsSync(ownServer))
    offenders.push(`own dist dir has no server/: ${path.join(relDistDir, "server")}`);
  if (!fs.existsSync(path.join(bundleRoot, "server.js"))) offenders.push("server.js missing");

  for (const { relPath, base } of walk(bundleRoot)) {
    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(base)) offenders.push(`${pattern.name}: ${relPath}`);
    }
  }
  return offenders;
}

function parseArgs(argv) {
  const out = { dist: process.env.NEXT_DIST_DIR || ".build/next", dirs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dist") out.dist = argv[++i];
    else if (argv[i] === "--dir") out.dirs.push(argv[++i]);
  }
  return out;
}

function main() {
  const { dist, dirs } = parseArgs(process.argv.slice(2));
  const relDistDir = path.isAbsolute(dist) ? path.relative(ROOT, dist) : dist;
  const bundles = [
    path.join(ROOT, relDistDir, "standalone"),
    ...dirs.map((d) => path.resolve(ROOT, d)),
  ];
  let failed = false;
  for (const bundle of bundles) {
    const offenders = auditBundle(bundle, { relDistDir });
    if (offenders.length === 0) {
      console.log(`[standalone-hygiene] OK — ${path.relative(ROOT, bundle) || bundle}`);
      continue;
    }
    failed = true;
    console.error(
      `[standalone-hygiene] FAIL — ${path.relative(ROOT, bundle) || bundle}: ${offenders.length} offender(s)`
    );
    for (const line of offenders.slice(0, 50)) console.error(`  - ${line}`);
    if (offenders.length > 50) console.error(`  … ${offenders.length - 50} more`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
