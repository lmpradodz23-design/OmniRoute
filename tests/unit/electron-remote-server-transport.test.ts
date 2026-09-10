/**
 * Finding E-4 (Fase 1 §1): "HTTPS mandatory outside loopback" for the Remote Server URL the
 * desktop shell attaches to. The shell sends the operator's dashboard session and provider
 * credentials to that origin, so a plaintext http:// remote on the public Internet is a
 * credential leak. Private networks keep http (a Docker/OrbStack container, a LAN box, a
 * single-label host name) — that is the documented use case of Remote Server mode.
 *
 * Contract of `isValidHttpUrl` (electron/lib/resolveRemoteServerUrl.js):
 *   https://…                                  → accepted anywhere
 *   http://loopback | RFC1918/CGNAT/link-local | .local/.localhost/.internal | single-label host
 *                                              → accepted (private network)
 *   http://<public FQDN or public IP>           → REJECTED
 *   anything else (ftp:, file:, javascript:, garbage) → rejected
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const {
  isValidHttpUrl,
  isPrivateNetworkHost,
} = require("../../electron/lib/resolveRemoteServerUrl");

describe("prompt window submit goes through the main-process policy", () => {
  const mainSrc = readFileSync(join(import.meta.dirname, "../../electron/main.js"), "utf8");
  const preloadSrc = readFileSync(
    join(import.meta.dirname, "../../electron/remoteServerPromptPreload.js"),
    "utf8"
  );

  it("submit is a request/response (invoke/handle) so the renderer can show a refusal", () => {
    assert.match(preloadSrc, /ipcRenderer\.invoke\("remote-server-prompt:submit"/);
    assert.match(mainSrc, /ipcMain\.handle\(\s*"remote-server-prompt:submit"/);
  });

  it("the submit handler validates with isValidHttpUrl before closing the window or touching the server", () => {
    const start = mainSrc.indexOf('ipcMain.handle(\n    "remote-server-prompt:submit"');
    const startAlt = mainSrc.indexOf('ipcMain.handle("remote-server-prompt:submit"');
    const idx = start !== -1 ? start : startAlt;
    assert.ok(idx !== -1, "submit handler must exist");
    const body = mainSrc.slice(idx, idx + 900);
    const validateIdx = body.indexOf("isValidHttpUrl(normalized)");
    const closeIdx = body.indexOf("remoteServerPromptWindow?.close()");
    const applyIdx = body.indexOf("setRemoteServerUrl(");
    assert.ok(validateIdx !== -1 && closeIdx !== -1 && applyIdx !== -1);
    assert.ok(validateIdx < closeIdx && validateIdx < applyIdx, "validate first");
    assert.match(body.slice(validateIdx, closeIdx), /ok:\s*false/);
  });
});

describe("isPrivateNetworkHost", () => {
  it("recognises loopback, RFC1918, CGNAT, link-local, local suffixes and single-label names", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "::1",
      "10.0.0.5",
      "172.16.0.9",
      "172.31.255.1",
      "192.168.1.10",
      "100.64.0.1",
      "169.254.10.10",
      "nas",
      "from-env",
      "omniroute.local",
      "box.localhost",
      "svc.internal",
    ]) {
      assert.equal(isPrivateNetworkHost(h), true, h);
    }
  });

  it("rejects public names and addresses", () => {
    for (const h of [
      "omniroute.example.com",
      "8.8.8.8",
      "172.32.0.1",
      "203.0.113.5",
      "example.org",
    ]) {
      assert.equal(isPrivateNetworkHost(h), false, h);
    }
  });
});

describe("isValidHttpUrl — transport policy", () => {
  it("accepts https anywhere", () => {
    assert.equal(isValidHttpUrl("https://omniroute.example.com"), true);
    assert.equal(isValidHttpUrl("https://127.0.0.1:8443"), true);
  });

  it("accepts plain http only on a private network", () => {
    assert.equal(isValidHttpUrl("http://localhost:20128"), true);
    assert.equal(isValidHttpUrl("http://192.168.1.10:20128"), true);
    assert.equal(isValidHttpUrl("http://from-env:20128"), true);
    assert.equal(isValidHttpUrl("http://omniroute.local:20128"), true);
  });

  it("REJECTS plain http to a public host (credentials would travel in clear)", () => {
    assert.equal(isValidHttpUrl("http://omniroute.example.com"), false);
    assert.equal(isValidHttpUrl("http://8.8.8.8:20128"), false);
    assert.equal(isValidHttpUrl("http://203.0.113.5"), false);
  });

  it("still rejects non-http schemes and garbage", () => {
    for (const u of [
      "ftp://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      assert.equal(isValidHttpUrl(u), false, u);
    }
  });
});
