// Static import-reachability from chatgpt-web v4.0.7 executors (repo @ f9a1cc8).
// Follows relative + aliased imports; skips bare npm packages. Reports reachable
// in-repo files and (later) which differ from c0b2253.
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: node reach.cjs <repoRoot>"); process.exit(1); }

const ENTRIES = [
  "open-sse/executors/chatgpt-web.ts",
  "open-sse/executors/chatgpt-web-codex.ts",
  "open-sse/executors/chatgpt-web-codex/credentials.ts",
  "open-sse/executors/chatgpt-web-codex/doctor.ts",
  "open-sse/executors/chatgpt-web-codex/models.ts",
  "open-sse/executors/chatgpt-web-codex/runtime.ts",
  "open-sse/executors/chatgpt-web-codex/storageState.ts",
  "open-sse/executors/chatgpt-web-codex/tunnelClient.ts",
];

const EXTS = ["", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx", ".d.ts"];
const INDEX = ["/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

function exists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function resolveBase(baseAbs) {
  for (const e of EXTS) { const c = baseAbs + e; if (exists(c)) return c; }
  for (const i of INDEX) { const c = baseAbs + i; if (exists(c)) return c; }
  return null;
}

// map a specifier (from file `fromRel`) to an in-repo file rel path, or null
function resolveSpec(spec, fromRel) {
  let baseAbs = null;
  if (spec.startsWith(".")) {
    baseAbs = path.resolve(ROOT, path.dirname(fromRel), spec);
  } else if (spec === "@omniroute/open-sse") {
    baseAbs = path.resolve(ROOT, "open-sse");
  } else if (spec.startsWith("@omniroute/open-sse/")) {
    baseAbs = path.resolve(ROOT, "open-sse", spec.slice("@omniroute/open-sse/".length));
  } else if (spec === "@omniroute/browser-pool") {
    baseAbs = path.resolve(ROOT, "packages/browser-pool/src");
  } else if (spec.startsWith("@omniroute/browser-pool/")) {
    baseAbs = path.resolve(ROOT, "packages/browser-pool/src", spec.slice("@omniroute/browser-pool/".length));
  } else if (spec.startsWith("@/")) {
    baseAbs = path.resolve(ROOT, "src", spec.slice(2));
  } else {
    return null; // bare npm package
  }
  const hit = resolveBase(baseAbs);
  if (!hit) return null;
  let rel = path.relative(ROOT, hit).split(path.sep).join("/");
  if (rel.startsWith("..")) return null; // outside repo
  return rel;
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const SPEC_RES = [
  /\bimport\s+(?:[\s\S]*?)\s+from\s*["']([^"']+)["']/g,
  /\bexport\s+(?:[\s\S]*?)\s+from\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function specsOf(fileRel) {
  const abs = path.resolve(ROOT, fileRel);
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { return []; }
  src = stripComments(src);
  const out = new Set();
  for (const re of SPEC_RES) { let m; re.lastIndex = 0; while ((m = re.exec(src))) out.add(m[1]); }
  return [...out];
}

const visited = new Set();
const unresolved = new Map(); // spec -> count (non-bare that failed)
const edges = new Map(); // fileRel -> Set(depRel)
const queue = [...ENTRIES];
for (const e of ENTRIES) if (!exists(path.resolve(ROOT, e))) console.error("MISSING ENTRY:", e);

while (queue.length) {
  const f = queue.shift();
  if (visited.has(f)) continue;
  visited.add(f);
  const deps = new Set();
  for (const spec of specsOf(f)) {
    const r = resolveSpec(spec, f);
    if (r) { deps.add(r); if (!visited.has(r)) queue.push(r); }
    else if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("@omniroute/")) {
      unresolved.set(spec, (unresolved.get(spec) || 0) + 1);
    }
  }
  edges.set(f, deps);
}

const reachable = [...visited].sort();
fs.writeFileSync(path.join(__dirname, "reachable.txt"), reachable.join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, "edges.json"), JSON.stringify([...edges].map(([k,v])=>[k,[...v]]), null, 0));
console.log("REACHABLE_TOTAL=" + reachable.length);
console.log("UNRESOLVED_INTERNAL=" + unresolved.size);
if (unresolved.size) console.log([...unresolved.keys()].sort().slice(0,40).map(s=>"  ? "+s).join("\n"));
