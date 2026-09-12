/**
 * Finding #3 residual — GET /api/monitoring/health reports the storage-encryption posture to a
 * management caller (`storage.status`, plaintext counts, bind exposure) and never to an
 * anonymous one (GHSA-mvf8 liveness-only view).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { NextRequest } from "next/server";
import { makeManagementSessionRequest } from "../helpers/managementSession.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-health-storage-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
delete process.env.STORAGE_ENCRYPTION_KEY;

const core = await import("../../src/lib/db/core.ts");
const route = await import("../../src/app/api/monitoring/health/route.ts");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("management view carries storage readiness and flags plaintext rows as insecure_storage", async () => {
  const db = core.getDbInstance();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO provider_connections (id, provider, auth_type, name, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("pc-plain", "openai", "apikey", "plain", "sk-plaintext-secret", now, now);
  route.__test_resetMonitoringHealthPayloadCache();

  const sessionReq = (await makeManagementSessionRequest(
    "http://localhost/api/monitoring/health"
  )) as unknown as NextRequest;
  const res = await route.GET(sessionReq as never);
  const body = (await res.json()) as { storage?: Record<string, unknown> };

  assert.ok(body.storage, "management view must include the storage section");
  assert.equal(body.storage.status, "insecure_storage");
  assert.equal(body.storage.encryptionConfigured, false);
  assert.equal(
    (body.storage.byColumn as Record<string, number>)["provider_connections.api_key"],
    1
  );
  assert.equal(typeof body.storage.exposed, "boolean");
  assert.ok(!JSON.stringify(body).includes("sk-plaintext-secret"), "no secret value in health");
});

test("anonymous view stays liveness-only (no storage posture leak)", async () => {
  const res = await route.GET(new Request("http://localhost/api/monitoring/health") as never);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal("storage" in body, false);
});
