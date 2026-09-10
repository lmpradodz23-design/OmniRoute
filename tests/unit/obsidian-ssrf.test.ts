/**
 * Regression for SSRF finding S-5 (Fase 1): the Obsidian Local REST API client and the vault
 * sync-server client reached their operator-configured base URL through a bare `fetch` —
 * no resolved-address validation, no connection pinning, redirects followed.
 *
 * Contract after the fix:
 *  - cloud metadata is blocked before any socket, even for a hostname that RESOLVES to it;
 *  - private/LAN targets need the integration policy (local-first by default; `network.allowPrivate`
 *    pins it in tests) — a public hostname resolving to a private ip is classified by the address;
 *  - a guard decision is terminal: no retry/backoff, the error surfaces as `OutboundUrlGuardError`;
 *  - redirects are never followed;
 *  - the existing behaviour is preserved on the admitted path: Bearer auth, method/body/headers
 *    pass-through, JSON vs text by content-type, 401/403 → ObsidianAuthError, 404 →
 *    ObsidianNotFoundError, 5xx retried then ObsidianServerError, refused port → ObsidianServerError.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  ObsidianAuthError,
  ObsidianNotFoundError,
  ObsidianServerError,
  createObsidianClient,
  createSyncServerClient,
} from "@/lib/obsidian/api";
import { OutboundUrlGuardError } from "@/shared/network/outboundUrlGuard";
import type { WebhookLookupFn } from "@/shared/network/hardenedWebhookFetch";

const lookupTo = (address: string): WebhookLookupFn => async () => [{ address, family: 4 }];

const isGuardError = (e: unknown) => e instanceof OutboundUrlGuardError;

describe("obsidian client — blocked targets (no socket, no retry)", () => {
  it("blocks the cloud-metadata literal even under the private opt-in, without retrying", async () => {
    const client = createObsidianClient("k", "http://169.254.169.254:27123", { allowPrivate: true });
    const start = Date.now();
    await assert.rejects(client.checkStatus(), isGuardError);
    // The retry loop sleeps 200ms+400ms between attempts; a guard decision must not enter it.
    assert.ok(Date.now() - start < 150, "guard decisions are terminal (no backoff)");
  });

  it("blocks a public hostname that RESOLVES to a private ip when private egress is off", async () => {
    const client = createObsidianClient("k", "http://vault.example.test:27123", {
      lookup: lookupTo("10.0.0.7"),
      allowPrivate: false,
    });
    await assert.rejects(client.checkStatus(), isGuardError);
  });

  it("blocks a public hostname that RESOLVES to cloud metadata even under the opt-in", async () => {
    const client = createObsidianClient("k", "http://vault.example.test:27123", {
      lookup: lookupTo("169.254.169.254"),
      allowPrivate: true,
    });
    await assert.rejects(client.readNote("notes/a.md"), isGuardError);
  });

  it("sync client: blocks the cloud-metadata literal", async () => {
    const sync = createSyncServerClient("tok", "http://169.254.169.254:27781", { allowPrivate: true });
    await assert.rejects(sync.getStatus(), isGuardError);
  });

  it("sync client: blocks a private resolved address when private egress is off", async () => {
    const sync = createSyncServerClient("tok", "http://sync.example.test", {
      lookup: lookupTo("192.168.1.9"),
      allowPrivate: false,
    });
    await assert.rejects(sync.triggerSync(), isGuardError);
  });
});

describe("obsidian client — admitted loopback target keeps the existing behaviour", () => {
  let server: Server;
  let base = "";
  let hits: Array<{ method: string; url: string; auth?: string; contentType?: string; body: string }> = [];
  let mode: "ok" | "text" | "redirect" | "401" | "404" | "500" | "sync-ok" | "sync-500" = "ok";

  before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        hits.push({
          method: req.method ?? "",
          url: req.url ?? "",
          auth: req.headers.authorization,
          contentType: req.headers["content-type"],
          body: raw,
        });
        switch (mode) {
          case "redirect":
            res.writeHead(302, { Location: "http://127.0.0.1:9/never" });
            return res.end();
          case "401":
            res.writeHead(401, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ message: "bad token" }));
          case "404":
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ message: "no such note" }));
          case "500":
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ message: "boom" }));
          case "text":
            res.writeHead(200, { "Content-Type": "text/markdown" });
            return res.end("# hello");
          case "sync-ok":
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: true, pulled: 1, pushed: 2, deleted: 0, conflicts: 0 }));
          case "sync-500":
            res.writeHead(500, { "Content-Type": "text/plain" });
            return res.end("sync exploded");
          default:
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ status: "OK", service: "Obsidian Local REST API" }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const reset = (m: typeof mode) => {
    mode = m;
    hits = [];
  };

  it("GET with Bearer auth, JSON by content-type", async () => {
    reset("ok");
    const client = createObsidianClient("secret-key", base, { allowPrivate: true });
    const status = (await client.checkStatus()) as { status: string };
    assert.equal(status.status, "OK");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].method, "GET");
    assert.equal(hits[0].url, "/");
    assert.equal(hits[0].auth, "Bearer secret-key");
  });

  it("PUT body + headers pass through; text by content-type", async () => {
    reset("text");
    const client = createObsidianClient("k", base, { allowPrivate: true });
    await client.writeNote("dir/note.md", "# hello");
    assert.equal(hits[0].method, "PUT");
    assert.equal(hits[0].url, "/vault/dir/note.md");
    assert.equal(hits[0].contentType, "text/markdown");
    assert.equal(hits[0].body, "# hello");
    const text = await client.readNote("dir/note.md");
    assert.equal(text, "# hello");
  });

  it("loopback is admitted under the default (local-first) policy with no network options", async () => {
    reset("ok");
    const client = createObsidianClient("k", base);
    const status = (await client.checkStatus()) as { status: string };
    assert.equal(status.status, "OK");
  });

  it("never follows a redirect from the admitted target", async () => {
    reset("redirect");
    const client = createObsidianClient("k", base, { allowPrivate: true });
    await assert.rejects(client.getTags(), isGuardError);
    assert.equal(hits.length, 1, "the redirect hop must not be requested");
  });

  it("401 → ObsidianAuthError (no retry)", async () => {
    reset("401");
    const client = createObsidianClient("k", base, { allowPrivate: true });
    await assert.rejects(client.checkStatus(), (e: unknown) => e instanceof ObsidianAuthError);
    assert.equal(hits.length, 1);
  });

  it("404 → ObsidianNotFoundError (no retry)", async () => {
    reset("404");
    const client = createObsidianClient("k", base, { allowPrivate: true });
    await assert.rejects(client.readNote("missing.md"), (e: unknown) => e instanceof ObsidianNotFoundError);
    assert.equal(hits.length, 1);
  });

  it("5xx → retried once, then ObsidianServerError", async () => {
    reset("500");
    const client = createObsidianClient("k", base, { allowPrivate: true });
    await assert.rejects(client.checkStatus(), (e: unknown) => e instanceof ObsidianServerError);
    assert.equal(hits.length, 2, "MAX_RETRIES=2 → exactly two attempts");
  });

  it("refused loopback port → ObsidianServerError with the reachability hint", async () => {
    const closed = await (async () => {
      const probe = createServer();
      await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((r) => probe.close(() => r()));
      return port;
    })();
    const client = createObsidianClient("k", `http://127.0.0.1:${closed}`, { allowPrivate: true });
    await assert.rejects(
      client.checkStatus(),
      (e: unknown) => e instanceof ObsidianServerError && /Cannot reach Obsidian/.test(e.message)
    );
  });

  it("sync client: Bearer token + JSON result on the admitted target; non-ok → Error with status", async () => {
    reset("sync-ok");
    const sync = createSyncServerClient("sync-tok", base, { allowPrivate: true });
    const result = await sync.triggerSync();
    assert.equal(result.pushed, 2);
    assert.equal(hits[0].method, "POST");
    assert.equal(hits[0].url, "/vault/sync/trigger");
    assert.equal(hits[0].auth, "Bearer sync-tok");

    reset("sync-500");
    await assert.rejects(sync.getStatus(), (e: unknown) => e instanceof Error && /Sync server 500: sync exploded/.test(e.message));
  });
});
