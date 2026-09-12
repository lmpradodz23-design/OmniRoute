/**
 * REPRO #8950 — Setting the first dashboard login password fails with HTTP 400
 * PASSWORD_REQUIRED, deadlocking every fresh install.
 *
 * Root cause: isColdBoot only fires while requireLogin===false, but the
 * Security tab forces requireLogin ON before the password form is reachable,
 * so the first newPassword write always demands a currentPassword that cannot
 * exist yet.
 *
 * Fix: add `|| Boolean(body.newPassword)` to the cold-boot condition so that
 * setting the first password is always treated as cold boot, regardless of
 * the current requireLogin state.
 *
 * Regression guard: once a password hash exists, the gate fires as before
 * (currentPassword required for security-impacting changes).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { setupSettingsFixture, mockSettings } from "../_mocks/settings.ts";
import { makeManagementSessionRequest } from "../../helpers/managementSession.ts";

const fixture = setupSettingsFixture("probe-8950");

process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const core = await import("../../../src/lib/db/core.ts");
const settingsDb = await import("../../../src/lib/db/settings.ts");
const runtime = await import("../../../src/lib/config/runtimeSettings.ts");
const settingsRoute = await import("../../../src/app/api/settings/route.ts");
const managementPassword = await import("../../../src/lib/auth/managementPassword.ts");

test.beforeEach(async () => {
  await fixture.resetStorage();
  runtime.resetRuntimeSettingsStateForTests();
});

test.after(() => {
  core.resetDbInstance();
  fixture.cleanup();
});

// U3 (audit/04): the "enable requireLogin first, then set the password" two-step that this repro
// documented is exactly the lockout the Security tab used to cause (login demanded with no
// password to give). The contract is now: `requireLogin: true` alone → 400
// PASSWORD_REQUIRED_TO_ENABLE_LOGIN; the first password still needs no currentPassword, and the
// tab sends `{ requireLogin: true, newPassword }` in ONE request. The #8950 guarantee — first
// password write never demands a currentPassword that cannot exist — is kept below.
test("#8950 contract: the first password never needs a currentPassword; enabling login alone is refused", async () => {
  // Simulate fresh install: no password hash, requireLogin is false.
  await mockSettings({ setupComplete: true, requireLogin: false });

  // Enabling requireLogin with nothing to sign in with is refused (was the #8950 step 1).
  const alone = await settingsRoute.PATCH(
    await makeManagementSessionRequest("http://localhost/api/settings", {
      method: "PATCH",
      body: { requireLogin: true },
    })
  );
  assert.equal(alone.status, 400);
  assert.equal(
    ((await alone.json()) as { error?: { code?: string } }).error?.code,
    "PASSWORD_REQUIRED_TO_ENABLE_LOGIN"
  );

  // First password (no currentPassword because none exists yet) — cold boot, as #8950 fixed.
  const first = await settingsRoute.PATCH(
    await makeManagementSessionRequest("http://localhost/api/settings", {
      method: "PATCH",
      body: { newPassword: "my-first-password" },
    })
  );
  assert.equal(
    first.status,
    200,
    `first password write should succeed without currentPassword, got ${first.status}`
  );
  const firstBody = (await first.json()) as Record<string, unknown>;
  assert.equal(firstBody.error, undefined, JSON.stringify(firstBody));

  // Verify the password was actually stored.
  const configured = managementPassword.hasManagementPasswordConfigured(
    (await settingsDb.getSettings()) as Record<string, unknown>
  );
  assert.equal(configured, true, "management password should be configured after first write");
});

test("#8950 contract: requireLogin + the first newPassword in one request also needs no currentPassword", async () => {
  await mockSettings({ setupComplete: true, requireLogin: false });

  const res = await settingsRoute.PATCH(
    await makeManagementSessionRequest("http://localhost/api/settings", {
      method: "PATCH",
      body: { requireLogin: true, newPassword: "my-first-password" },
    })
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const settings = (await settingsDb.getSettings()) as Record<string, unknown>;
  assert.equal(settings.requireLogin, true);
  assert.equal(managementPassword.hasManagementPasswordConfigured(settings), true);
});
