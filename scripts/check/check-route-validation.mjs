#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "src", "app", "api");
const FILE_NAME = "route.ts";
// Both spellings the codebase uses for the incoming request object. Deliberately NOT
// `\w+\.json(` — that would also match `NextResponse.json(` / `res.json(` (response
// builders and upstream reads) in ~300 routes that never parse a request body.
const REQUEST_JSON_REGEX = /\b(?:request|req)\.json\s*\(/;

// Pre-existing routes that parse `req.json()` without validateBody()/safeParse(), frozen
// so the widened regex is green NOW and blocks only NEW gaps. Each entry is real debt:
// remove it here when the route gains validation. Do NOT add entries for new routes.
const KNOWN_UNVALIDATED_ROUTES = new Set([
  "src/app/api/logs/detail/route.ts",
  "src/app/api/providers/[id]/login/route.ts",
]);
const VALIDATE_BODY_REGEX = /\bvalidateBody\s*\(/;
const SAFE_PARSE_REGEX = /\.safeParse\s*\(/;

/**
 * Walk directory recursively and collect route files.
 * @param {string} dir
 * @returns {string[]}
 */
function collectRouteFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRouteFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name === FILE_NAME) {
      files.push(fullPath);
    }
  }

  return files;
}

if (!fs.existsSync(API_ROOT)) {
  console.error(`[t06:route-validation] FAIL - API root not found: ${API_ROOT}`);
  process.exit(1);
}

const routeFiles = collectRouteFiles(API_ROOT).sort();
const missingValidation = [];
const staleAllowlist = [];

for (const fullPath of routeFiles) {
  const source = fs.readFileSync(fullPath, "utf8");
  if (!REQUEST_JSON_REGEX.test(source)) continue;
  // Accept either validateBody() or .safeParse() as validation
  const rel = path.relative(ROOT, fullPath).split(path.sep).join("/");
  const validated = VALIDATE_BODY_REGEX.test(source) || SAFE_PARSE_REGEX.test(source);
  if (validated) {
    if (KNOWN_UNVALIDATED_ROUTES.has(rel)) staleAllowlist.push(rel);
    continue;
  }
  if (!KNOWN_UNVALIDATED_ROUTES.has(rel)) missingValidation.push(rel);
}

if (staleAllowlist.length > 0) {
  console.error(
    "[t06:route-validation] FAIL - KNOWN_UNVALIDATED_ROUTES entries that now validate (remove them):"
  );
  for (const file of staleAllowlist) console.error(`  - ${file}`);
  process.exit(1);
}

if (missingValidation.length > 0) {
  console.error(
    "[t06:route-validation] FAIL - routes with request.json() without validateBody() or .safeParse():"
  );
  for (const file of missingValidation) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

console.log(
  `[t06:route-validation] PASS - ${routeFiles.length} route files scanned, all request/req.json() usages are validated (frozen debt: ${KNOWN_UNVALIDATED_ROUTES.size}).`
);
