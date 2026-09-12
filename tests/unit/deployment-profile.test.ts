/**
 * Finding #3 residual — the storage-encryption gate must recognise an EXPOSED profile, not only
 * NODE_ENV=production: an operator who explicitly binds the server beyond loopback
 * (HOST / HOSTNAME) has exposed the credential store to the network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isExposedBind,
  isExposedDeploymentProfile,
  isLoopbackBindHost,
  resolveBindHost,
} from "@/lib/db/deploymentProfile";
import { isStorageEncryptionRequired } from "@/lib/db/encryption";

describe("resolveBindHost / isLoopbackBindHost", () => {
  it("defaults to 0.0.0.0 (what run-next.mjs and the standalone server bind) when unset", () => {
    assert.deepEqual(resolveBindHost({}), { host: "0.0.0.0", explicit: false });
    assert.deepEqual(resolveBindHost({ HOST: "  " }), { host: "0.0.0.0", explicit: false });
  });

  it("prefers HOST over HOSTNAME and marks an explicit value", () => {
    assert.deepEqual(resolveBindHost({ HOST: "127.0.0.1", HOSTNAME: "0.0.0.0" }), {
      host: "127.0.0.1",
      explicit: true,
    });
    assert.deepEqual(resolveBindHost({ HOSTNAME: "0.0.0.0" }), { host: "0.0.0.0", explicit: true });
  });

  it("classifies loopback spellings", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "[::1]",
      "::ffff:127.0.0.1",
      "LOCALHOST",
    ]) {
      assert.equal(isLoopbackBindHost(h), true, h);
    }
    for (const h of ["0.0.0.0", "::", "192.168.1.10", "10.0.0.5", "omniroute.example.com", ""]) {
      assert.equal(isLoopbackBindHost(h), false, h);
    }
  });
});

describe("isExposedBind / isExposedDeploymentProfile", () => {
  it("reports the default bind as exposed (readiness tells the truth) but does not gate a dev profile on it", () => {
    assert.equal(isExposedBind({}), true);
    assert.equal(isExposedDeploymentProfile({ NODE_ENV: "development" }), false);
  });

  it("an explicit non-loopback bind is an exposed profile", () => {
    assert.equal(isExposedDeploymentProfile({ NODE_ENV: "development", HOST: "0.0.0.0" }), true);
    assert.equal(isExposedDeploymentProfile({ HOSTNAME: "192.168.1.10" }), true);
    assert.equal(isExposedDeploymentProfile({ HOST: "127.0.0.1" }), false);
    assert.equal(isExposedDeploymentProfile({ HOST: "localhost" }), false);
  });

  it("production is always an exposed profile", () => {
    assert.equal(isExposedDeploymentProfile({ NODE_ENV: "production", HOST: "127.0.0.1" }), true);
  });
});

describe("isStorageEncryptionRequired(env)", () => {
  it("requires a key for an explicit non-loopback bind even outside production", () => {
    assert.equal(isStorageEncryptionRequired({ NODE_ENV: "development", HOST: "0.0.0.0" }), true);
    assert.equal(
      isStorageEncryptionRequired({ NODE_ENV: "development", HOSTNAME: "10.0.0.5" }),
      true
    );
  });

  it("does not require a key for a loopback or default-dev bind", () => {
    assert.equal(
      isStorageEncryptionRequired({ NODE_ENV: "development", HOST: "127.0.0.1" }),
      false
    );
    assert.equal(isStorageEncryptionRequired({ NODE_ENV: "development" }), false);
  });

  it("the explicit override wins in both directions", () => {
    assert.equal(
      isStorageEncryptionRequired({
        NODE_ENV: "production",
        OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION: "false",
      }),
      false
    );
    assert.equal(
      isStorageEncryptionRequired({
        NODE_ENV: "development",
        OMNIROUTE_REQUIRE_STORAGE_ENCRYPTION: "1",
      }),
      true
    );
  });
});
