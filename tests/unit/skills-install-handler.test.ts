/**
 * P-8 (audit/03 §2.3): `POST /api/skills/install` took a `handlerCode` string of up to 50 000
 * characters that was never evaluated — it is only a key into the executor's handler registry.
 * The field is now `handler` (with `handlerCode` kept as a deprecated alias) and an unknown
 * handler is rejected at install time with the list of registered ones.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { makeManagementSessionRequest } from "../helpers/managementSession.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-skills-install-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "skills-install-secret";
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const core = await import("../../src/lib/db/core.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const route = await import("../../src/app/api/skills/install/route.ts");

test.before(async () => {
  core.resetDbInstance();
  await settingsDb.updateSettings({ requireLogin: false });
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function install(body: Record<string, unknown>) {
  const req = await makeManagementSessionRequest("http://localhost/api/skills/install", {
    method: "POST",
    body,
  });
  return route.POST(req as never);
}

const base = {
  name: "read-a-file",
  description: "reads a file",
  schema: { input: {}, output: {} },
};

test("an unknown handler name is refused at install time with the registered list", async () => {
  const res = await install({ ...base, handler: "totally_made_up" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; handlers: string[] } };
  assert.equal(body.error.code, "UNKNOWN_SKILL_HANDLER");
  assert.ok(body.error.handlers.includes("file_read"));
  assert.deepEqual(body.error.handlers, route.knownSkillHandlers());
});

test("a blob of code is rejected by shape (it was never executed anyway)", async () => {
  const res = await install({ ...base, handlerCode: "module.exports = () => process.exit(1)" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: { code?: string } };
  assert.notEqual(body.error?.code, "UNKNOWN_SKILL_HANDLER", "shape validation runs first");
});

test("`handler` (and the deprecated `handlerCode` alias) naming a registered handler installs", async () => {
  const a = await install({ ...base, name: "via-handler", handler: "file_read" });
  assert.equal(a.status, 200, await a.text());
  const b = await install({ ...base, name: "via-alias", handlerCode: "web_fetch" });
  assert.equal(b.status, 200, await b.text());
});

test("a body without either field is a validation error", async () => {
  const res = await install({ ...base });
  assert.equal(res.status, 400);
});
