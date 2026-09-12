/**
 * documentedOperations — the explicit allowlist for the OpenAPI "Try It" proxy (#5 residual).
 *
 * The proxy may only forward operations that are documented in `docs/openapi.yaml`
 * (method + path template). A generic `/api/` prefix is not an allowlist: it admits every
 * undocumented, internal or future route the dashboard never meant to expose. The spec is the
 * same file the Try panel renders its catalog from, so by construction every documented
 * operation stays reachable.
 *
 * Path templates (`/api/keys/{id}`) are compiled to anchored regexes; the cache is keyed by
 * the spec file's mtime, like `src/app/api/openapi/spec/route.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

export const OPENAPI_SPEC_CANDIDATES = [
  path.join(/* turbopackIgnore: true */ process.cwd(), "docs", "openapi.yaml"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "app", "docs", "openapi.yaml"),
  // Legacy locations kept as fallback for old standalone bundles (pre-#4781 move
  // from docs/reference/openapi.yaml to the canonical docs/openapi.yaml).
  path.join(/* turbopackIgnore: true */ process.cwd(), "docs", "reference", "openapi.yaml"),
  path.join(/* turbopackIgnore: true */ process.cwd(), "app", "docs", "reference", "openapi.yaml"),
];

const DOCUMENTED_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

export interface DocumentedOperation {
  method: string;
  template: string;
  pattern: RegExp;
}

let cache: { specPath: string; mtime: number; operations: DocumentedOperation[] } | null = null;

export function resolveOpenApiSpecPath(candidates: readonly string[] = OPENAPI_SPEC_CANDIDATES) {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `/api/keys/{id}` → `^/api/keys/[^/]+/?$` (one path segment per parameter, no `..`/slashes). */
export function templateToPattern(template: string): RegExp {
  const normalized = template.length > 1 ? template.replace(/\/+$/, "") : template;
  const source = normalized
    .split(/(\{[^}]+\})/)
    .map((part) => (/^\{[^}]+\}$/.test(part) ? "[^/]+" : escapeRegex(part)))
    .join("");
  return new RegExp(`^${source}/?$`);
}

/**
 * A generated placeholder such as `/api/{omnirouteApiCatchAll}` (the Next.js `[...catchAll]`
 * route) is not a documented operation — it would re-admit every path under `/api/` and void
 * the allowlist. Any template whose parameter name says "catch-all" is skipped.
 */
export function isCatchAllTemplate(template: string): boolean {
  return /\{[^}]*catch[-_]?all[^}]*\}/i.test(template);
}

export function compileDocumentedOperations(spec: unknown): DocumentedOperation[] {
  const paths =
    spec && typeof spec === "object" && (spec as { paths?: unknown }).paths
      ? ((spec as { paths: Record<string, unknown> }).paths ?? {})
      : {};
  const operations: DocumentedOperation[] = [];
  for (const [template, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object" || !template.startsWith("/")) continue;
    if (isCatchAllTemplate(template)) continue;
    const pattern = templateToPattern(template);
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      if (!DOCUMENTED_METHODS.has(method)) continue;
      operations.push({ method: method.toUpperCase(), template, pattern });
    }
  }
  return operations;
}

export function loadDocumentedOperations(): DocumentedOperation[] {
  const specPath = resolveOpenApiSpecPath();
  if (!specPath) return [];
  const mtime = fs.statSync(specPath).mtimeMs;
  if (cache && cache.specPath === specPath && cache.mtime === mtime) return cache.operations;
  const operations = compileDocumentedOperations(yaml.load(fs.readFileSync(specPath, "utf-8")));
  cache = { specPath, mtime, operations };
  return operations;
}

/**
 * Whether `method pathname` is a documented operation. HEAD is admitted where GET is documented;
 * OPTIONS is never (it is not an operation the panel offers). Query strings are the caller's.
 */
export function isDocumentedOperation(
  method: string,
  pathname: string,
  operations: readonly DocumentedOperation[] = loadDocumentedOperations()
): boolean {
  const upper = method.toUpperCase();
  const effective = upper === "HEAD" ? "GET" : upper;
  if (effective === "OPTIONS") return false;
  return operations.some((op) => op.method === effective && op.pattern.test(pathname));
}
