import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { diskSnapshotPath, readDiskSnapshot, writeDiskSnapshot } from "../src/cache.js";
import type { CatalogSnapshot } from "../src/cache.js";

function snapshotWith(ids: string[]): CatalogSnapshot {
  return {
    models: ids.map((id) => ({ id, name: id, api: { id, npm: "@ai-sdk/openai-compatible" } })),
    combos: [],
    autoCombos: [],
    providers: [],
  } as unknown as CatalogSnapshot;
}

describe("disk snapshot: atomic replace", () => {
  it("concurrent writes always leave a complete snapshot and no temp files behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omniroute-atomic-"));
    const prev = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = dir;
    try {
      // Two catalog publishes racing (a boot-time snapshot and the optional-tier upgrade
      // of another instance). With a truncate-then-write the reader could observe an
      // empty or partial file; with write-temp-then-rename every observation is one of
      // the two complete payloads.
      await Promise.all([
        writeDiskSnapshot("atomic", snapshotWith(["a1", "a2"]), "fp"),
        writeDiskSnapshot("atomic", snapshotWith(["b1"]), "fp"),
      ]);
      const file = diskSnapshotPath("atomic");
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { models: Array<{ id: string }> };
      const ids = parsed.models.map((m) => m.id).join(",");
      assert.ok(ids === "a1,a2" || ids === "b1", `unexpected snapshot content: ${ids}`);
      const back = await readDiskSnapshot("atomic", "fp");
      assert.ok(back && back.models.length > 0, "the snapshot must read back as a warm catalog");
      const leftovers = readdirSync(dirname(file)).filter((name) => name.endsWith(".tmp"));
      assert.deepEqual(leftovers, [], "temp files must be renamed away or removed");
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
      else process.env.OPENCODE_DATA_DIR = prev;
    }
  });
});
