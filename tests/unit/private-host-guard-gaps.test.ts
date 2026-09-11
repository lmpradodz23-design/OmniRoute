// Regression for SSRF finding S-2 (Fase 1): the CANONICAL private-host guard in
// `src/shared/network/privateHost.ts` had the same four gaps the relay copy
// (`src/lib/proxyRelay/privateHostname.ts`) already closed, plus it treated raw
// numeric IPv4 spellings as public. `hardenedWebhookFetch`, `safeOutboundFetch`
// and `outboundUrlGuard` all classify through this module, so every gap here was
// an egress bypass everywhere.
//
// Measured against the pre-fix guard (`isPrivateHost` on the raw string):
//
//   localhost.                -> false   (FQDN root dot defeats exact + suffix tests)
//   svc.internal.             -> false   (same, `.internal` suffix)
//   ::127.0.0.1 / ::7f00:1    -> false   (IPv4-compatible ::/96, not `::ffff:`)
//   feb0::1                   -> false   (fe80::/10 spans fe80-febf, guard checked `fe80:`)
//   2130706433 / 0x7f000001   -> false   (decimal/hex literal; `ipVersion` = 0 -> "public")
//   0177.0.0.1 / 127.1        -> false   (octal / short-form dotted; not a canonical quad)
//
// The relay copy must stay self-contained (it is embedded verbatim into edge
// workers via Function#toString), so instead of collapsing the two we assert
// PARITY on the vectors both are designed to handle, which stops future drift.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPrivateHost, normalizeHost } from "../../src/shared/network/privateHost";
import { isPrivateRelayHostname } from "../../src/lib/proxyRelay/privateHostname";

/** What URL-based callers pass in: `new URL(...).hostname`, brackets included. */
function asUrlHostname(host: string): string {
  const bracketed = host.includes(":") ? `[${host}]` : host;
  return new URL(`http://${bracketed}/`).hostname;
}

describe("canonical private-host guard — the four relay gaps, on the raw string", () => {
  for (const host of ["::", "localhost.", "::127.0.0.1", "::7f00:1", "feb0::1"]) {
    it(`blocks ${host}`, () => {
      assert.equal(isPrivateHost(host), true);
    });
  }

  it("blocks a trailing-dot form of every suffix rule", () => {
    for (const host of [
      "app.localhost.",
      "printer.local.",
      "svc.internal.",
      "metadata.google.internal.",
    ]) {
      assert.equal(isPrivateHost(host), true, host);
    }
  });

  it("normalizeHost strips the FQDN root dot (and brackets) but leaves a lone dot alone", () => {
    assert.equal(normalizeHost("localhost."), "localhost");
    assert.equal(normalizeHost("[::1]"), "::1");
    assert.equal(normalizeHost("Example.COM."), "example.com");
    assert.equal(normalizeHost("."), ".");
  });
});

describe("canonical private-host guard — non-canonical IPv4 spellings fail closed", () => {
  // No legitimate public endpoint is written this way; a raw-config caller that
  // bypasses WHATWG normalization must not be able to smuggle 127.0.0.1 past the guard.
  for (const host of ["2130706433", "0x7f000001", "0177.0.0.1", "0x7f.0.0.1", "127.1", "127.0.1"]) {
    it(`blocks ${host}`, () => {
      assert.equal(isPrivateHost(host), true);
    });
  }
});

describe("canonical private-host guard — uncompressed IPv6 spellings (final audit B-1)", () => {
  // The `startsWith("::")` shortcut only sees the compressed spelling. Written out in full the
  // very same loopback / IPv4-mapped addresses reached the IPv6 branch and were classified
  // PUBLIC. WHATWG `URL` compresses them, so URL callers were safe, but every raw-string caller
  // (provider registry, relay config) was not — and a defence-in-depth guard must not depend
  // on which spelling it is handed.
  for (const host of [
    "0:0:0:0:0:ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "0000:0000:0000:0000:0000:ffff:7f00:0001",
    "0:0:0:0:0:0:0:1",
    "0:0:0:0:0:0:127.0.0.1",
    "0:0:0:0:0:0:0:0",
    "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254
    "64:ff9b::192.168.1.1",
  ]) {
    it(`blocks ${host}`, () => {
      assert.equal(isPrivateHost(host), true);
    });
    it(`relay guard blocks ${host} too`, () => {
      assert.equal(isPrivateRelayHostname(host), true);
    });
  }

  for (const host of ["64:ff9b::808:808", "64:ff9b::8.8.8.8", "2001:db8:0:0:0:0:0:1"]) {
    it(`still allows ${host}`, () => {
      assert.equal(isPrivateHost(host), false);
      assert.equal(isPrivateRelayHostname(host), false);
    });
  }
});

describe("canonical private-host guard — previously-correct behaviour is unchanged", () => {
  for (const host of [
    "localhost",
    "0.0.0.0",
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "fd00::1",
    "fe80::1",
    "app.localhost",
    "printer.local",
    "svc.internal",
  ]) {
    it(`still blocks ${host}`, () => {
      assert.equal(isPrivateHost(host), true);
    });
  }

  for (const host of [
    "example.com",
    "api.anthropic.com",
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700::1111",
  ]) {
    it(`still allows ${host}`, () => {
      assert.equal(isPrivateHost(host), false);
    });
  }

  it("blocks an empty or whitespace host", () => {
    assert.equal(isPrivateHost(""), true);
    assert.equal(isPrivateHost("   "), true);
  });

  it("does not treat a public host as private just because it ends in a dot", () => {
    assert.equal(isPrivateHost("example.com."), false);
  });

  it("does not misclassify a public IPv6 that merely contains 'fe8' later in the address", () => {
    assert.equal(isPrivateHost("2001:db8::fe80:1"), false);
  });
});

describe("canonical guard and relay guard agree (drift guard)", () => {
  // Vectors both guards are designed to handle. The numeric-literal fail-closed
  // rule above is deliberately canonical-only (the relay always receives a
  // WHATWG-normalized hostname), so it is excluded here.
  const vectors = [
    "::",
    "localhost.",
    "::127.0.0.1",
    "feb0::1",
    "app.localhost.",
    "svc.internal.",
    "localhost",
    "0.0.0.0",
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "64:ff9b::7f00:1",
    "64:ff9b::808:808",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "fd00::1",
    "fe80::1",
    "example.com",
    "example.com.",
    "8.8.8.8",
    "2606:4700::1111",
  ];
  for (const host of vectors) {
    it(`parity on ${host}`, () => {
      const u = asUrlHostname(host);
      assert.equal(isPrivateHost(u), isPrivateRelayHostname(u), `canonical vs relay on ${u}`);
    });
  }
});
