/**
 * P-1 / P-4 (audit/03 §2.3): installing from the marketplace downloaded `plugin.tar.gz`, then
 * handed the UN-extracted tarball's directory to `pluginManager.install`, which found no
 * `plugin.json` — marketplace installs never worked (P-4). And the SHA-256 published by the
 * registry was optional, so a registry could ship an unverifiable archive (P-1).
 *
 * `extractPluginArchive` unpacks a tar.gz into an isolated directory with a fail-closed
 * policy (files/directories only, no absolute or `..` paths, entry-count and byte limits) and
 * locates the plugin root; `installMarketplaceEntry` requires the checksum, verifies it,
 * extracts and installs, and always cleans its temp directory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { extractPluginArchive, PluginArchiveError } from "../../src/lib/plugins/archive.ts";
import {
  installMarketplaceEntry,
  type MarketplaceEntry,
} from "../../src/lib/plugins/marketplace.ts";

// ── minimal ustar writer: full control over names/types (symlinks, traversal, sizes) ──
type Entry = { name: string; type?: "0" | "5" | "2" | "1"; content?: string; linkname?: string };

function header(name: string, size: number, type: string, linkname = ""): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "utf8");
  h.write("0000000\0", 108, 8, "utf8");
  h.write("0000000\0", 116, 8, "utf8");
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  h.write(
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0")}\0`,
    136,
    12,
    "utf8"
  );
  h.write("        ", 148, 8, "utf8"); // checksum placeholder (spaces)
  h.write(type, 156, 1, "utf8");
  h.write(linkname, 157, 100, "utf8");
  h.write("ustar\0", 257, 6, "utf8");
  h.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return h;
}

function tarGz(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const type = e.type ?? (e.name.endsWith("/") ? "5" : "0");
    const body = type === "0" ? Buffer.from(e.content ?? "", "utf8") : Buffer.alloc(0);
    parts.push(header(e.name, body.length, type, e.linkname));
    if (body.length) {
      parts.push(body);
      const pad = (512 - (body.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad, 0));
    }
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}

const MANIFEST = JSON.stringify({
  name: "hello-plugin",
  version: "1.0.0",
  description: "test",
  main: "index.js",
});
const GOOD: Entry[] = [
  { name: "plugin.json", content: MANIFEST },
  { name: "index.js", content: "export default {};" },
];

let work: string;
test.beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "omr-plugin-archive-"));
});
test.afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function extractFrom(entries: Entry[], limits?: Parameters<typeof extractPluginArchive>[2]) {
  // one isolated archive + target per call so a test can exercise several archives
  const dir = fs.mkdtempSync(path.join(work, "case-"));
  const archive = path.join(dir, "plugin.tar.gz");
  fs.writeFileSync(archive, tarGz(entries));
  const dest = path.join(dir, "extract");
  fs.mkdirSync(dest);
  return extractPluginArchive(archive, dest, limits);
}

async function expectArchiveError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof PluginArchiveError, `expected PluginArchiveError, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
}

test("extracts a flat archive and reports its root as the plugin directory", async () => {
  const result = await extractFrom(GOOD);
  assert.ok(fs.existsSync(path.join(result.pluginDir, "plugin.json")));
  assert.ok(fs.existsSync(path.join(result.pluginDir, "index.js")));
  assert.equal(result.entries, 2);
});

test("extracts an archive with a single top-level folder and points at that folder", async () => {
  const result = await extractFrom([
    { name: "hello-plugin/" },
    { name: "hello-plugin/plugin.json", content: MANIFEST },
    { name: "hello-plugin/index.js", content: "export default {};" },
  ]);
  assert.equal(path.basename(result.pluginDir), "hello-plugin");
  assert.ok(fs.existsSync(path.join(result.pluginDir, "plugin.json")));
});

test("rejects symlink and hardlink entries (nothing from the archive is kept)", async () => {
  await expectArchiveError(
    extractFrom([...GOOD, { name: "evil", type: "2", linkname: "/etc/passwd" }]),
    "ENTRY_TYPE"
  );
  await expectArchiveError(
    extractFrom([...GOOD, { name: "link", type: "1", linkname: "index.js" }]),
    "ENTRY_TYPE"
  );
});

test("rejects path traversal and absolute paths, and writes nothing outside the target", async () => {
  await expectArchiveError(extractFrom([...GOOD, { name: "../evil.js", content: "x" }]), "PATH");
  const escaped: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "evil.js") escaped.push(p);
    }
  };
  walk(work);
  assert.deepEqual(escaped, [], "escaped file must not exist anywhere under the work tree");
  await expectArchiveError(extractFrom([...GOOD, { name: "/tmp/abs.js", content: "x" }]), "PATH");
  await expectArchiveError(extractFrom([...GOOD, { name: "a\\..\\b.js", content: "x" }]), "PATH");
});

test("enforces entry-count and byte limits (zip-bomb style archives)", async () => {
  const many: Entry[] = [...GOOD];
  for (let i = 0; i < 10; i += 1) many.push({ name: `f${i}.txt`, content: "x" });
  await expectArchiveError(extractFrom(many, { maxEntries: 5 }), "TOO_MANY_ENTRIES");
  await expectArchiveError(
    extractFrom([...GOOD, { name: "big.bin", content: "y".repeat(2000) }], { maxTotalBytes: 500 }),
    "TOO_LARGE"
  );
  await expectArchiveError(
    extractFrom([...GOOD, { name: "big.bin", content: "y".repeat(2000) }], { maxEntryBytes: 1000 }),
    "TOO_LARGE"
  );
});

test("rejects an archive without plugin.json at the root or in a single top-level folder", async () => {
  await expectArchiveError(extractFrom([{ name: "readme.txt", content: "hi" }]), "NO_MANIFEST");
  await expectArchiveError(
    extractFrom([
      { name: "a/plugin.json", content: MANIFEST },
      { name: "b/plugin.json", content: MANIFEST },
    ]),
    "NO_MANIFEST"
  );
});

test("rejects data that is not a gzip tarball", async () => {
  const archive = path.join(work, "plugin.tar.gz");
  fs.writeFileSync(archive, Buffer.from("<html>not a tarball</html>"));
  const dest = path.join(work, "extract");
  fs.mkdirSync(dest);
  await expectArchiveError(extractPluginArchive(archive, dest), "FORMAT");
});

// ── installMarketplaceEntry ──────────────────────────────────────────────────────────────

function entryFor(_archive: Buffer, overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    name: "hello-plugin",
    version: "1.0.0",
    description: "test",
    author: "t",
    license: "MIT",
    downloadUrl: "https://registry.example.com/hello-plugin-1.0.0.tar.gz",
    tags: [],
    downloads: 0,
    rating: 5,
    verified: true,
    lastUpdated: "2026-09-10",
    ...overrides,
  };
}

async function sha256(buffer: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

test("P-1: an entry without a SHA-256 checksum is refused before anything is downloaded", async () => {
  let downloaded = false;
  await assert.rejects(
    installMarketplaceEntry(entryFor(tarGz(GOOD)), {
      download: async () => {
        downloaded = true;
        return tarGz(GOOD);
      },
      install: async () => ({ name: "hello-plugin", version: "1.0.0" }),
    }),
    /checksum/i
  );
  assert.equal(downloaded, false);
  await assert.rejects(
    installMarketplaceEntry(entryFor(tarGz(GOOD), { checksum: "not-a-sha256" }), {
      download: async () => tarGz(GOOD),
      install: async () => ({ name: "hello-plugin", version: "1.0.0" }),
    }),
    /checksum/i
  );
});

test("P-1: a checksum mismatch aborts and nothing is installed", async () => {
  let installed = false;
  await assert.rejects(
    installMarketplaceEntry(entryFor(tarGz(GOOD), { checksum: "a".repeat(64) }), {
      download: async () => tarGz(GOOD),
      install: async () => {
        installed = true;
        return { name: "hello-plugin", version: "1.0.0" };
      },
    }),
    /mismatch/i
  );
  assert.equal(installed, false);
});

test("P-4: a verified archive is extracted and the plugin directory (with plugin.json) is installed; temp files are removed", async () => {
  const archive = tarGz(GOOD);
  let receivedDir = "";
  const result = await installMarketplaceEntry(
    entryFor(archive, { checksum: await sha256(archive) }),
    {
      download: async () => archive,
      install: async (dir) => {
        receivedDir = dir;
        assert.ok(
          fs.existsSync(path.join(dir, "plugin.json")),
          "install must get the extracted plugin dir"
        );
        return { name: "hello-plugin", version: "1.0.0" };
      },
    }
  );
  assert.deepEqual(result, { name: "hello-plugin", version: "1.0.0" });
  assert.ok(receivedDir);
  assert.equal(fs.existsSync(receivedDir), false, "temp extraction dir is cleaned up");
});

test("P-4: a malicious archive that passes the checksum is still rejected by the extractor", async () => {
  const archive = tarGz([...GOOD, { name: "../escape.js", content: "x" }]);
  let installed = false;
  await assert.rejects(
    installMarketplaceEntry(entryFor(archive, { checksum: await sha256(archive) }), {
      download: async () => archive,
      install: async () => {
        installed = true;
        return { name: "hello-plugin", version: "1.0.0" };
      },
    }),
    (err: unknown) => err instanceof PluginArchiveError && err.code === "PATH"
  );
  assert.equal(installed, false);
});
