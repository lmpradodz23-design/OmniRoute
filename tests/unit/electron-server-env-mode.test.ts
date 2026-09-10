/**
 * Regression for finding E-7 (Fase 1 §6): the desktop bootstrap persists JWT_SECRET,
 * STORAGE_ENCRYPTION_KEY and API_KEY_SECRET to `<DATA_DIR>/server.env` in plaintext without
 * restricting the file mode, so any local user could read the secrets that unlock the
 * credential store. The write must be owner-only (0o600) and an existing file must be
 * tightened on the way (mode only applies on creation).
 *
 * `writeOwnerOnlyFile` is a pure helper (unit-tested on the real filesystem); main.js's use
 * is asserted statically because it cannot run without the Electron binary.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { writeOwnerOnlyFile } = require("../../electron/lib/ownerOnlyFile");

describe("writeOwnerOnlyFile (pure)", () => {
  it("creates the file with mode 0o600 and writes the content", () => {
    const dir = mkdtempSync(join(tmpdir(), "omniroute-server-env-"));
    try {
      const file = join(dir, "server.env");
      writeOwnerOnlyFile(file, "A=1\n");
      assert.equal(readFileSync(file, "utf8"), "A=1\n");
      if (process.platform !== "win32") {
        assert.equal(statSync(file).mode & 0o777, 0o600);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tightens an existing world-readable file when overwriting", () => {
    const dir = mkdtempSync(join(tmpdir(), "omniroute-server-env-"));
    try {
      const file = join(dir, "server.env");
      const fs = require("node:fs");
      fs.writeFileSync(file, "OLD=1\n", { encoding: "utf8", mode: 0o644 });
      writeOwnerOnlyFile(file, "NEW=2\n");
      assert.equal(readFileSync(file, "utf8"), "NEW=2\n");
      if (process.platform !== "win32") {
        assert.equal(statSync(file).mode & 0o777, 0o600);
      }
      assert.ok(existsSync(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("main.js persists server.env owner-only (static)", () => {
  const source = readFileSync(join(process.cwd(), "electron/main.js"), "utf8");

  it("uses writeOwnerOnlyFile for server.env instead of a bare writeFileSync", () => {
    const idx = source.indexOf('path.join(dataDir, "server.env")');
    assert.ok(idx !== -1, "server.env path must be built from dataDir");
    const slice = source.slice(idx, idx + 2500);
    assert.ok(
      slice.includes("writeOwnerOnlyFile(serverEnvPath"),
      "server.env must be written via writeOwnerOnlyFile"
    );
    assert.ok(
      !slice.includes("fs.writeFileSync(serverEnvPath"),
      "no bare writeFileSync for server.env"
    );
  });

  it("ships the helper in the packaged app (build.files)", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "electron/package.json"), "utf8"));
    const files: string[] = pkg.build?.files ?? [];
    assert.ok(
      files.some(
        (f) =>
          f === "lib/ownerOnlyFile.js" || f === "lib/**" || f === "lib/**/*" || f.startsWith("lib/")
      ),
      "electron/lib/ownerOnlyFile.js must be included in build.files"
    );
  });
});
