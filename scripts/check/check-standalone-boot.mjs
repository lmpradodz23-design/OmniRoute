#!/usr/bin/env node
/**
 * check:standalone-boot — boots the assembled standalone bundle (the Docker / Electron runtime
 * path, NOT the npm tarball that check:pack-boot covers) in isolation and proves it serves.
 *
 *   node scripts/check/check-standalone-boot.mjs [--dist .build/next] [--port 20444]
 *
 * Why this exists: a verification build in the final audit shipped a standalone whose route
 * traces had lost the bundle's own chunks (a tracing exclude on the dist dir) — every gate was
 * green and the bundle answered 500 ChunkLoadError on its first request. The only proof that a
 * standalone works is starting it.
 *
 * What it does: temp DATA_DIR, loopback bind, the production profile's required secrets
 * (STORAGE_ENCRYPTION_KEY etc. — throwaway values), `node server.js` from the bundle, then
 * GET /api/health/ping must answer 200 within the deadline, /v1/models without a key must be
 * 401 (auth is wired), and the login page must render 200. The process tree is always torn
 * down and the temp dir removed.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BOOT_DEADLINE_MS = Number(process.env.STANDALONE_BOOT_DEADLINE_MS || 240_000);
const POLL_INTERVAL_MS = 2_000;

export function parseArgs(argv, env = process.env) {
  const out = { dist: env.NEXT_DIST_DIR || ".build/next", port: 20444 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dist") out.dist = argv[++i];
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
  }
  return out;
}

/** Environment for an isolated production-profile boot (throwaway secrets, loopback only). */
export function bootEnv({ dataDir, port }, base = process.env) {
  return {
    ...base,
    DATA_DIR: dataDir,
    PORT: String(port),
    HOST: "127.0.0.1",
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    DISABLE_SQLITE_AUTO_BACKUP: "true",
    // The exposed/production profile refuses to boot without these (readiness #3) — the gate
    // must exercise that profile, so it supplies throwaway values, never operator secrets.
    JWT_SECRET: "standalone-boot-gate-jwt-secret-with-sufficient-length",
    API_KEY_SECRET: "standalone-boot-gate-api-key-secret-long-enough",
    STORAGE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    OMNIROUTE_SKIP_UPDATE_CHECK: "1",
  };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function probe(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
    return res.status;
  } catch {
    return 0;
  }
}

async function main() {
  const { dist, port } = parseArgs(process.argv.slice(2));
  const relDistDir = path.isAbsolute(dist) ? path.relative(ROOT, dist) : dist;
  const standalone = path.join(ROOT, relDistDir, "standalone");
  const serverJs = path.join(standalone, "server.js");
  if (!fs.existsSync(serverJs)) {
    console.error(
      `[standalone-boot] ${path.relative(ROOT, serverJs)} missing — run \`npm run build\` first`
    );
    process.exit(2);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-standalone-boot-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const logPath = path.join(tmp, "server.log");
  const log = fs.openSync(logPath, "w");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: standalone,
    env: bootEnv({ dataDir, port }),
    stdio: ["ignore", log, log],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const failures = [];
  const started = Date.now();
  try {
    let ping = 0;
    while (Date.now() - started < BOOT_DEADLINE_MS) {
      if (child.exitCode !== null) {
        failures.push(`server.js exited with code ${child.exitCode} before serving`);
        break;
      }
      ping = await probe(`http://127.0.0.1:${port}/api/health/ping`);
      if (ping === 200) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (ping !== 200)
      failures.push(
        `/api/health/ping answered ${ping} (expected 200) within ${BOOT_DEADLINE_MS} ms`
      );
    if (failures.length === 0) {
      const models = await probe(`http://127.0.0.1:${port}/v1/models`);
      if (models !== 401)
        failures.push(`/v1/models without a key answered ${models} (expected 401)`);
      const login = await probe(`http://127.0.0.1:${port}/login`);
      if (login !== 200) failures.push(`/login answered ${login} (expected 200)`);
    }
  } finally {
    killTree(child);
    fs.closeSync(log);
  }
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (failures.length > 0) {
    console.error(`[standalone-boot] FAIL — ${path.relative(ROOT, standalone)} (${elapsed} s):`);
    for (const f of failures) console.error(`  - ${f}`);
    const tail = fs
      .readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => /fatal|error|Error/i.test(l) && !/^\s+at /.test(l))
      .slice(-8);
    for (const l of tail) console.error(`  | ${l.slice(0, 200)}`);
    console.error(`  log: ${logPath}`);
    process.exit(1);
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(
    `[standalone-boot] PASS — ${path.relative(ROOT, standalone)} booted, ping 200, /v1/models 401, /login 200 (${elapsed} s)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[standalone-boot] crashed:", err?.message ?? err);
    process.exit(1);
  });
}
