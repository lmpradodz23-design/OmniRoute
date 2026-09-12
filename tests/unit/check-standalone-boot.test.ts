import test from "node:test";
import assert from "node:assert/strict";
import { bootEnv, parseArgs } from "../../scripts/check/check-standalone-boot.mjs";

// The standalone boot gate must exercise the PRODUCTION profile (the one Docker/Electron run)
// with throwaway secrets, bound to loopback, on an isolated data dir — never the operator's.

test("parseArgs defaults to the configured dist dir and a gate-reserved port", () => {
  assert.deepEqual(parseArgs([], {}), { dist: ".build/next", port: 20444 });
  assert.deepEqual(parseArgs([], { NEXT_DIST_DIR: ".build/next-verify" }), {
    dist: ".build/next-verify",
    port: 20444,
  });
  assert.deepEqual(parseArgs(["--dist", ".build/x", "--port", "20450"], {}), {
    dist: ".build/x",
    port: 20450,
  });
});

test("bootEnv runs the production profile with throwaway secrets on loopback and an isolated DATA_DIR", () => {
  const env = bootEnv({ dataDir: "/tmp/x/data", port: 20444 }, { PATH: "/usr/bin" });
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.PORT, "20444");
  assert.equal(env.DATA_DIR, "/tmp/x/data");
  assert.equal(
    env.REQUIRE_API_KEY,
    "true",
    "the profile where /v1/* must answer 401 without a key"
  );
  assert.equal(env.PATH, "/usr/bin", "inherits the base environment");
  for (const key of ["JWT_SECRET", "API_KEY_SECRET", "STORAGE_ENCRYPTION_KEY"]) {
    assert.ok(typeof env[key] === "string" && env[key].length >= 32, `${key} is a throwaway value`);
  }
  assert.match(
    env.STORAGE_ENCRYPTION_KEY,
    /^[0-9a-f]{64}$/,
    "64 hex chars, what the readiness check accepts"
  );
});

test("bootEnv never leaks a real operator secret from the base environment into the gate", () => {
  const env = bootEnv(
    { dataDir: "/tmp/x/data", port: 20444 },
    { STORAGE_ENCRYPTION_KEY: "operator-real-key", DATA_DIR: "/home/op/.omniroute" }
  );
  assert.notEqual(env.STORAGE_ENCRYPTION_KEY, "operator-real-key");
  assert.equal(env.DATA_DIR, "/tmp/x/data");
});
