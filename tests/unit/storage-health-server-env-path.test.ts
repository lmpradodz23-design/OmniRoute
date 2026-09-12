// Audit C-07: the dashboard must show the REAL `server.env` location, which only the
// server knows (`resolveDataDir()` honours DATA_DIR, %APPDATA%, XDG, legacy ~/.omniroute).
// GET /api/storage/health (management-session route — not in publicApiRoutes, so
// src/server/authz/classify.ts classes it MANAGEMENT) is the existing endpoint that
// already exposes `dataDir`/`dbPath`; it must additionally expose the absolute,
// copy-pasteable `serverEnvPath` = join(dataDir, "server.env"), matching
// scripts/build/bootstrap-env.mjs, which is the writer of that file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { GET } from "../../src/app/api/storage/health/route";
import { resolveDataDir } from "../../src/lib/dataPaths";

describe("GET /api/storage/health — serverEnvPath (audit C-07)", () => {
  it("returns the absolute server.env path inside the resolved data dir", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    const expected = path.join(resolveDataDir(), "server.env");
    assert.equal(body.serverEnvPath, expected);
    assert.ok(path.isAbsolute(String(body.serverEnvPath)), "serverEnvPath must be absolute");
    // Existing fields stay (additive change only).
    assert.equal(typeof body.dataDir, "string");
    assert.equal(typeof body.dbPath, "string");
  });
});
