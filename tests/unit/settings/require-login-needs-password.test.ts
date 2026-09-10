/**
 * U3 (audit/04-PRODUCT-GAPS.md): turning "Require login" ON without any password locked the
 * operator out — `isAuthRequired` starts demanding a session the moment `requireLogin` is
 * true and `setupComplete` is set, but there is no password to sign in with, so the dashboard
 * bounced to /login → "Configure password" → the onboarding wizard from scratch.
 *
 * Contract pinned here: `requireLogin: true` is refused (400 PASSWORD_REQUIRED_TO_ENABLE_LOGIN)
 * unless a password is already configured, is set in the SAME request (`newPassword`), or SSO
 * is enabled. The Security tab therefore sends both in one PATCH.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { setupSettingsFixture, mockSettings } from "../_mocks/settings.ts";
import { makeManagementSessionRequest } from "../../helpers/managementSession.ts";

const fixture = setupSettingsFixture("require-login-needs-password");
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";
delete process.env.INITIAL_PASSWORD;

const core = await import("../../../src/lib/db/core.ts");
const settingsDb = await import("../../../src/lib/db/settings.ts");
const runtime = await import("../../../src/lib/config/runtimeSettings.ts");
const settingsRoute = await import("../../../src/app/api/settings/route.ts");
const requireLoginRoute = await import("../../../src/app/api/settings/require-login/route.ts");
const { hasManagementPasswordConfigured } =
  await import("../../../src/lib/auth/managementPassword.ts");
const { isAuthRequired } = await import("../../../src/shared/utils/apiAuth.ts");

test.beforeEach(async () => {
  delete process.env.INITIAL_PASSWORD;
  await fixture.resetStorage();
  runtime.resetRuntimeSettingsStateForTests();
});

test.after(() => {
  core.resetDbInstance();
  fixture.cleanup();
});

async function patch(body: Record<string, unknown>) {
  return settingsRoute.PATCH(
    await makeManagementSessionRequest("http://localhost/api/settings", { method: "PATCH", body })
  );
}

test("PATCH requireLogin=true without any password is refused with a coded 400 and nothing is persisted", async () => {
  await mockSettings({ setupComplete: true, requireLogin: false });

  const res = await patch({ requireLogin: true });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "PASSWORD_REQUIRED_TO_ENABLE_LOGIN");

  const settings = (await settingsDb.getSettings()) as Record<string, unknown>;
  assert.equal(settings.requireLogin, false, "the lockout state must never be written");
  assert.equal(
    await isAuthRequired({ method: "GET", url: "http://localhost/dashboard/settings" } as never),
    false,
    "the dashboard stays reachable"
  );
});

test("PATCH requireLogin=true together with the first newPassword succeeds in one step (no currentPassword yet)", async () => {
  await mockSettings({ setupComplete: true, requireLogin: false });

  const res = await patch({ requireLogin: true, newPassword: "first-password-123" });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));

  const settings = (await settingsDb.getSettings()) as Record<string, unknown>;
  assert.equal(settings.requireLogin, true);
  assert.equal(hasManagementPasswordConfigured(settings), true);
});

test("PATCH requireLogin=true is accepted when a password is already configured (with re-auth)", async () => {
  await mockSettings({ setupComplete: true, requireLogin: false });
  assert.equal((await patch({ newPassword: "already-there-123" })).status, 200);

  const res = await patch({ requireLogin: true, currentPassword: "already-there-123" });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(((await settingsDb.getSettings()) as Record<string, unknown>).requireLogin, true);
});

test("POST /api/settings/require-login refuses requireLogin=true with no password anywhere", async () => {
  await mockSettings({ setupComplete: false, requireLogin: false });

  const res = await requireLoginRoute.POST(
    new Request("http://localhost/api/settings/require-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireLogin: true }),
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "PASSWORD_REQUIRED_TO_ENABLE_LOGIN");
  assert.equal(((await settingsDb.getSettings()) as Record<string, unknown>).requireLogin, false);
});

test("POST /api/settings/require-login still accepts requireLogin=true with a password in the same body", async () => {
  await mockSettings({ setupComplete: false, requireLogin: false });

  const res = await requireLoginRoute.POST(
    new Request("http://localhost/api/settings/require-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireLogin: true, password: "wizard-password-123" }),
    })
  );
  assert.equal(res.status, 200);
  const settings = (await settingsDb.getSettings()) as Record<string, unknown>;
  assert.equal(settings.requireLogin, true);
  assert.equal(hasManagementPasswordConfigured(settings), true);
});
