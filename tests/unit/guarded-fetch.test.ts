/**
 * Regression for SSRF findings S-5 / S-6 (Fase 1): `guardedFetch`, the outbound client for
 * operator-configured integration base URLs. Same egress properties as hardenedWebhookFetch —
 * classification by the RESOLVED address, metadata always blocked, private only under the opt-in,
 * connection pinned, redirects never followed — but it hands back a real Response so integration
 * clients keep their own status / content-type / body handling.
 *
 * No real DNS (`lookup` injected). Live cases use a loopback server under `allowPrivate: true`.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { guardedFetch } from "@/shared/network/guardedFetch";
import { OutboundUrlGuardError } from "@/shared/network/outboundUrlGuard";
import type { WebhookLookupFn } from "@/shared/network/hardenedWebhookFetch";

const lookupTo = (address: string, family: 4 | 6 = 4): WebhookLookupFn => {
  return async () => [{ address, family }];
};

describe("guardedFetch — blocked before any socket, classified by the resolved address", () => {
  it("blocks a public hostname that RESOLVES to cloud metadata even with the opt-in", async () => {
    await assert.rejects(
      guardedFetch("https://svc.example.test/x", {
        lookup: lookupTo("169.254.169.254"),
        allowPrivate: true,
      }),
      (e: unknown) => e instanceof OutboundUrlGuardError && /metadata/i.test((e as Error).message)
    );
  });

  it("blocks a public hostname that RESOLVES to a private ip when the opt-in is off", async () => {
    await assert.rejects(
      guardedFetch("https://svc.example.test/x", {
        lookup: lookupTo("10.1.2.3"),
        allowPrivate: false,
      }),
      (e: unknown) =>
        e instanceof OutboundUrlGuardError && /private|block/i.test((e as Error).message)
    );
  });

  it("blocks literal metadata / private / embedded credentials / bad scheme", async () => {
    await assert.rejects(guardedFetch("http://169.254.169.254/latest", { allowPrivate: true }));
    await assert.rejects(guardedFetch("http://127.0.0.1:9/x", { allowPrivate: false }));
    await assert.rejects(guardedFetch("https://user:pass@example.com/x", { allowPrivate: true }));
    await assert.rejects(guardedFetch("file:///etc/passwd", { allowPrivate: true }));
  });

  it("rejects an already-aborted caller signal without connecting", async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      guardedFetch("http://127.0.0.1:9/x", {
        allowPrivate: true,
        signal: ac.signal,
        timeoutMs: 2000,
      })
    );
  });
});

describe("guardedFetch — live loopback server", () => {
  let server: Server;
  let base = "";
  let requestCount = 0;
  let mode: "json" | "redirect" | "nocontent" | "hang" | "slowbody" = "json";
  let lastMethod = "";
  let lastBody = "";
  let lastHeader: string | undefined;

  before(async () => {
    server = createServer((req, res) => {
      requestCount += 1;
      lastMethod = req.method ?? "";
      lastHeader = req.headers["x-probe"] as string | undefined;
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        lastBody = raw;
        if (mode === "redirect") {
          res.writeHead(302, { Location: "http://127.0.0.1:9/internal-secret" });
          res.end();
          return;
        }
        if (mode === "nocontent") {
          res.writeHead(204, { "X-Empty": "yes" });
          res.end();
          return;
        }
        if (mode === "hang") {
          return; // never answer: exercises the time-to-headers bound
        }
        if (mode === "slowbody") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.write("part-1;");
          setTimeout(() => {
            try {
              res.end("part-2");
            } catch {
              /* socket may be gone */
            }
          }, 400);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "X-Custom": "hdr",
          Connection: "close",
        });
        res.end(JSON.stringify({ ok: true, echo: raw || null }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("never follows a redirect (no second request to the hop)", async () => {
    mode = "redirect";
    requestCount = 0;
    await assert.rejects(
      guardedFetch(`${base}/start`, { allowPrivate: true, timeoutMs: 3000 }),
      (e: unknown) =>
        e instanceof OutboundUrlGuardError && /redirect blocked/i.test((e as Error).message)
    );
    assert.equal(requestCount, 1, "the redirect target must NOT be fetched");
  });

  it("blocks the same loopback target entirely when the opt-in is off", async () => {
    mode = "json";
    requestCount = 0;
    await assert.rejects(
      guardedFetch(`${base}/x`, { allowPrivate: false, timeoutMs: 3000 }),
      (e: unknown) => e instanceof OutboundUrlGuardError
    );
    assert.equal(requestCount, 0);
  });

  it("returns a real Response: status, headers, json(), and passes method/headers/body through", async () => {
    mode = "json";
    requestCount = 0;
    const res = await guardedFetch(`${base}/api/thing`, {
      method: "POST",
      headers: { "X-Probe": "p1", "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      allowPrivate: true,
      timeoutMs: 3000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("x-custom"), "hdr");
    const data = (await res.json()) as { ok: boolean; echo: string | null };
    assert.equal(data.ok, true);
    assert.equal(data.echo, JSON.stringify({ hello: "world" }));
    assert.equal(requestCount, 1);
    assert.equal(lastMethod, "POST");
    assert.equal(lastHeader, "p1");
    assert.equal(lastBody, JSON.stringify({ hello: "world" }));
  });

  it("returns a body-less Response for 204 (headers preserved)", async () => {
    mode = "nocontent";
    const res = await guardedFetch(`${base}/empty`, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(res.status, 204);
    assert.equal(res.body, null);
    assert.equal(res.headers.get("x-empty"), "yes");
  });

  it("bounds the time to response headers", async () => {
    mode = "hang";
    await assert.rejects(guardedFetch(`${base}/hang`, { allowPrivate: true, timeoutMs: 300 }));
  });

  it("honors the caller's signal for the body, not just the headers", async () => {
    mode = "slowbody";
    const ac = new AbortController();
    const res = await guardedFetch(`${base}/slow`, {
      allowPrivate: true,
      timeoutMs: 3000,
      signal: ac.signal,
    });
    assert.equal(res.status, 200);
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(res.text(), "an aborted caller signal must abort the body read");
  });

  it("delivers a slow body completely when not aborted (backstop must not cut it)", async () => {
    mode = "slowbody";
    const res = await guardedFetch(`${base}/slow-ok`, { allowPrivate: true, timeoutMs: 3000 });
    assert.equal(await res.text(), "part-1;part-2");
  });
});
