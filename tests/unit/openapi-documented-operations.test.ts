/**
 * `src/lib/openapi/documentedOperations.ts` — the explicit allowlist behind the OpenAPI
 * "Try It" proxy (#5 residual). Pure compilation/matching against a synthetic spec, plus one
 * check against the real docs/openapi.yaml (the generated `/api/{omnirouteApiCatchAll}`
 * placeholder must never re-admit every /api/ path).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileDocumentedOperations,
  isCatchAllTemplate,
  isDocumentedOperation,
  loadDocumentedOperations,
  templateToPattern,
} from "@/lib/openapi/documentedOperations";

const SPEC = {
  paths: {
    "/api/keys": { get: {}, post: {} },
    "/api/keys/{id}": { get: {}, delete: {} },
    "/api/keys/{id}/devices": { get: {} },
    "/v1/chat/completions": { post: {} },
    "/api/{omnirouteApiCatchAll}": { get: {}, post: {}, put: {}, patch: {}, delete: {} },
    "/api/health": { get: {}, parameters: [] }, // non-method keys are ignored
    "not-a-path": { get: {} },
  },
};

describe("templateToPattern", () => {
  it("binds a parameter to exactly one path segment and tolerates a trailing slash", () => {
    const p = templateToPattern("/api/keys/{id}");
    assert.equal(p.test("/api/keys/key_1"), true);
    assert.equal(p.test("/api/keys/key_1/"), true);
    assert.equal(p.test("/api/keys/key_1/devices"), false);
    assert.equal(p.test("/api/keys/"), false);
    assert.equal(p.test("/api/keys/a/b"), false);
  });

  it("escapes regex metacharacters in literal segments", () => {
    assert.equal(templateToPattern("/api/v1.0/x").test("/api/v1X0/x"), false);
    assert.equal(templateToPattern("/api/v1.0/x").test("/api/v1.0/x"), true);
  });
});

describe("compileDocumentedOperations", () => {
  const ops = compileDocumentedOperations(SPEC);

  it("keeps documented method+template pairs and drops non-method keys and non-path entries", () => {
    const listed = ops.map((o) => `${o.method} ${o.template}`).sort();
    assert.deepEqual(listed, [
      "DELETE /api/keys/{id}",
      "GET /api/health",
      "GET /api/keys",
      "GET /api/keys/{id}",
      "GET /api/keys/{id}/devices",
      "POST /api/keys",
      "POST /v1/chat/completions",
    ]);
  });

  it("excludes generated catch-all placeholders", () => {
    assert.equal(isCatchAllTemplate("/api/{omnirouteApiCatchAll}"), true);
    assert.equal(isCatchAllTemplate("/api/keys/{id}"), false);
    assert.ok(ops.every((o) => !o.template.includes("CatchAll")));
  });

  it("isDocumentedOperation: exact method, HEAD as GET, OPTIONS never, query-less pathname", () => {
    assert.equal(isDocumentedOperation("GET", "/api/keys/key_1", ops), true);
    assert.equal(isDocumentedOperation("HEAD", "/api/keys/key_1", ops), true);
    assert.equal(isDocumentedOperation("PUT", "/api/keys/key_1", ops), false);
    assert.equal(isDocumentedOperation("OPTIONS", "/api/keys", ops), false);
    assert.equal(isDocumentedOperation("post", "/v1/chat/completions", ops), true);
    assert.equal(isDocumentedOperation("GET", "/api/does-not-exist", ops), false);
    assert.equal(isDocumentedOperation("POST", "/api/anything", ops), false);
  });
});

describe("real docs/openapi.yaml", () => {
  it("loads hundreds of operations and never admits an arbitrary /api/<segment> path", () => {
    const ops = loadDocumentedOperations();
    assert.ok(ops.length > 500, `expected a full catalog, got ${ops.length}`);
    assert.equal(isDocumentedOperation("GET", "/api/does-not-exist-xyz", ops), false);
    assert.equal(isDocumentedOperation("POST", "/api/does-not-exist-xyz", ops), false);
    assert.equal(isDocumentedOperation("GET", "/api/monitoring/health", ops), true);
    assert.equal(isDocumentedOperation("POST", "/api/combos/test", ops), true);
  });
});
