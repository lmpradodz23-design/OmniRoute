/**
 * Regression: the pinned dispatcher lookup must connect HOSTNAME targets.
 *
 * Node's `net.connect` runs with `autoSelectFamily` on by default (Node ≥ 20) and calls the
 * dispatcher `lookup` with `{ all: true }`, expecting an array of `{ address, family }`. The
 * original pin answered with a bare string, so every non-literal target through the hardened
 * clients failed to connect ("Invalid IP address: undefined") — webhooks, federation, OIDC
 * discovery and the integration clients all only worked for IP literals.
 *
 * These cases resolve a public-looking hostname to the loopback stand-in through an injected
 * resolver and prove (a) the connection is established, (b) it is pinned — the Host header still
 * carries the hostname while the socket reached the stand-in.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { guardedFetch } from "@/shared/network/guardedFetch";
import {
  hardenedWebhookFetch,
  pinnedLookup,
  type WebhookLookupFn,
} from "@/shared/network/hardenedWebhookFetch";

describe("pinnedLookup — honours both dns.lookup callback shapes", () => {
  const pinned = { address: "127.0.0.1", family: 4 as const };

  it("answers the `all: true` form with an array", () => {
    let got: unknown;
    pinnedLookup(pinned)(
      "host.example.test",
      { all: true },
      (err: Error | null, address: unknown) => {
        assert.equal(err, null);
        got = address;
      }
    );
    assert.deepEqual(got, [{ address: "127.0.0.1", family: 4 }]);
  });

  it("answers the legacy form with (address, family)", () => {
    let got: unknown[] = [];
    pinnedLookup(pinned)(
      "host.example.test",
      { family: 0 },
      (err: Error | null, address: unknown, family?: number) => {
        assert.equal(err, null);
        got = [address, family];
      }
    );
    assert.deepEqual(got, ["127.0.0.1", 4]);
  });
});

describe("hostname targets connect through the pinned dispatcher", () => {
  let server: Server;
  let port = 0;
  let seenHost: string | undefined;
  const lookup: WebhookLookupFn = async () => [{ address: "127.0.0.1", family: 4 }];

  before(async () => {
    server = createServer((req, res) => {
      seenHost = req.headers.host;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("guardedFetch: reaches the pinned address, Host header keeps the hostname", async () => {
    seenHost = undefined;
    const res = await guardedFetch(`http://pinned.example.test:${port}/g`, {
      lookup,
      allowPrivate: true,
      timeoutMs: 3000,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(seenHost, `pinned.example.test:${port}`);
  });

  it("hardenedWebhookFetch: reaches the pinned address, Host header keeps the hostname", async () => {
    seenHost = undefined;
    const res = await hardenedWebhookFetch(`http://pinned.example.test:${port}/w`, {
      method: "GET",
      lookup,
      allowPrivate: true,
      withholdPrivateBody: false,
      timeoutMs: 3000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.bodyText, JSON.stringify({ ok: true }));
    assert.equal(seenHost, `pinned.example.test:${port}`);
  });
});
