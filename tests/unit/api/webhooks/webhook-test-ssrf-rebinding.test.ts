/**
 * Regression tests for SSRF finding #1 (webhook test — redirect + DNS rebinding).
 *
 * Proves the hardened path:
 *  - classifies the target by the RESOLVED ip (a public hostname that resolves to a
 *    private/metadata address is blocked — DNS rebinding),
 *  - blocks cloud-metadata even under the private opt-in,
 *  - never follows a redirect (a 3xx is a blocked diagnostic, no body),
 *  - never returns the body of a private target,
 *  - pins the connection to the validated ip (connectivity still works).
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  hardenedWebhookFetch,
  resolveAndAssertWebhookTarget,
  type WebhookLookupFn,
} from "@/shared/network/hardenedWebhookFetch";
import { OutboundUrlGuardError } from "@/shared/network/outboundUrlGuard";

const lookupTo = (address: string, family: 4 | 6 = 4): WebhookLookupFn => {
  return async () => [{ address, family }];
};

describe("resolveAndAssertWebhookTarget — DNS rebinding classification", () => {
  it("blocks a public hostname that RESOLVES to cloud metadata (even with opt-in)", async () => {
    await assert.rejects(
      resolveAndAssertWebhookTarget("https://hook.example.test/x", {
        lookup: lookupTo("169.254.169.254"),
        allowPrivate: true,
      }),
      (e: unknown) => e instanceof OutboundUrlGuardError && /metadata/i.test((e as Error).message)
    );
  });

  it("blocks a public hostname that RESOLVES to a private ip when opt-in is OFF", async () => {
    await assert.rejects(
      resolveAndAssertWebhookTarget("https://hook.example.test/x", {
        lookup: lookupTo("10.1.2.3"),
        allowPrivate: false,
      }),
      (e: unknown) => e instanceof OutboundUrlGuardError && /private|block/i.test((e as Error).message)
    );
  });

  it("allows a private RESOLVED ip under opt-in and flags isPrivateTarget", async () => {
    const t = await resolveAndAssertWebhookTarget("https://hook.example.test/x", {
      lookup: lookupTo("10.1.2.3"),
      allowPrivate: true,
    });
    assert.equal(t.isPrivateTarget, true);
    assert.equal(t.addresses[0].address, "10.1.2.3");
  });

  it("allows a public RESOLVED ip and does not flag private", async () => {
    const t = await resolveAndAssertWebhookTarget("https://hook.example.test/x", {
      lookup: lookupTo("93.184.216.34"),
    });
    assert.equal(t.isPrivateTarget, false);
  });

  it("blocks literal metadata / private / embedded-credentials / bad protocol", async () => {
    await assert.rejects(resolveAndAssertWebhookTarget("http://169.254.169.254/latest"));
    await assert.rejects(resolveAndAssertWebhookTarget("http://127.0.0.1:9/x"));
    await assert.rejects(resolveAndAssertWebhookTarget("https://user:pass@example.com/x"));
    await assert.rejects(resolveAndAssertWebhookTarget("file:///etc/passwd"));
  });

  it("errors when a hostname resolves to no records", async () => {
    await assert.rejects(
      resolveAndAssertWebhookTarget("https://empty.example.test/x", { lookup: async () => [] }),
      /No DNS records/i
    );
  });
});

describe("hardenedWebhookFetch — redirect + private body withholding (live local server)", () => {
  let server: Server;
  let requestCount = 0;
  let mode: "redirect" | "ok" = "ok";
  let base = "";

  before(async () => {
    server = createServer((_req, res) => {
      requestCount += 1;
      if (mode === "redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:9/internal-secret" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
      res.end("SECRET-INTERNAL-BODY");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("never follows a redirect (3xx -> blocked, no second request to the hop)", async () => {
    mode = "redirect";
    requestCount = 0;
    await assert.rejects(
      hardenedWebhookFetch(`${base}/start`, { allowPrivate: true, timeoutMs: 3000 }),
      (e: unknown) => e instanceof OutboundUrlGuardError && /redirect blocked/i.test((e as Error).message)
    );
    assert.equal(requestCount, 1, "the redirect target must NOT be fetched");
  });

  it("withholds the body of a private target (connectivity only)", async () => {
    mode = "ok";
    const r = await hardenedWebhookFetch(`${base}/ping`, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(r.status, 200);
    assert.equal(r.isPrivateTarget, true);
    assert.equal(r.bodyText, "", "private target body must never be returned");
  });

  it("blocks the same private target entirely when opt-in is OFF", async () => {
    mode = "ok";
    await assert.rejects(
      hardenedWebhookFetch(`${base}/ping`, { allowPrivate: false, timeoutMs: 3000 }),
      (e: unknown) => e instanceof OutboundUrlGuardError
    );
  });
});
