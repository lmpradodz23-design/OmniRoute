/**
 * R-12 / E-6 (audit/02-ARCHITECTURE.md) — orphaned server grandchildren on macOS/Linux and
 * no PID record when the Electron main process dies.
 *
 * On POSIX `proc.kill(signal)` signals ONE pid; it does not walk the tree and it does not
 * reach a process group unless the child was spawned `detached` (own group) and the
 * signal is sent to `-pid`. The embedded server spawns grandchildren (MITM proxy,
 * tunnels, embedded services), so "Exit" left them running on macOS/Linux. And if the
 * main process itself dies (crash, SIGKILL, updater), nothing recorded the server pid,
 * so the next launch could not reap the orphan.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  killProcessTree,
  serverSpawnOptions,
  writeServerPidFile,
  readServerPidFile,
  removeServerPidFile,
  reapOrphanServer,
} = require("../../electron/processTree.js");

describe("serverSpawnOptions (R-12)", () => {
  it("POSIX: the server gets its own process group so the whole tree can be signalled", () => {
    assert.equal(serverSpawnOptions("linux").detached, true);
    assert.equal(serverSpawnOptions("darwin").detached, true);
  });
  it("win32: taskkill /T already walks the tree; no detached console group", () => {
    assert.equal(serverSpawnOptions("win32").detached, false);
  });
});

describe("killProcessTree POSIX group kill (R-12)", () => {
  it("signals the process GROUP (-pid) of the detached server, not just the child", () => {
    const calls: Array<[number, string]> = [];
    let directKill = false;
    const proc = {
      pid: 4321,
      kill: () => {
        directKill = true;
      },
    };
    killProcessTree(proc, {
      platform: "linux",
      signal: "SIGTERM",
      killFn: (pid: number, sig: string) => {
        calls.push([pid, sig]);
      },
    });
    assert.deepEqual(calls, [[-4321, "SIGTERM"]]);
    assert.equal(directKill, false, "group signal already reached the child");
  });

  it("falls back to proc.kill when the group signal fails (child not detached / ESRCH)", () => {
    let killedWith: string | null = null;
    const proc = {
      pid: 77,
      kill: (sig: string) => {
        killedWith = sig;
      },
    };
    killProcessTree(proc, {
      platform: "darwin",
      signal: "SIGKILL",
      killFn: () => {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      },
    });
    assert.equal(killedWith, "SIGKILL");
  });
});

describe("server PID file (R-12)", () => {
  const dir = mkdtempSync(join(tmpdir(), "omr-pidfile-"));
  const pidFile = join(dir, "server.pid");

  it("round-trips pid + identity and is removed on demand", () => {
    writeServerPidFile(pidFile, {
      pid: 12345,
      execPath: "/opt/app/omniroute",
      script: "/opt/app/server.js",
    });
    const record = readServerPidFile(pidFile);
    assert.equal(record?.pid, 12345);
    assert.equal(record?.execPath, "/opt/app/omniroute");
    assert.equal(record?.script, "/opt/app/server.js");
    assert.ok(typeof record?.startedAt === "string");
    assert.match(readFileSync(pidFile, "utf8"), /"pid":\s*12345/);
    removeServerPidFile(pidFile);
    assert.equal(existsSync(pidFile), false);
    assert.equal(readServerPidFile(pidFile), null);
  });

  it("reaps a live orphan whose identity matches the recorded server", () => {
    writeServerPidFile(pidFile, {
      pid: 555,
      execPath: "/opt/app/omniroute",
      script: "/opt/app/server.js",
    });
    const killed: Array<[number, string]> = [];
    const result = reapOrphanServer(pidFile, {
      platform: "linux",
      isAlive: (pid: number) => pid === 555,
      commandLineOf: () => "/opt/app/omniroute /opt/app/server.js",
      killFn: (pid: number, sig: string) => {
        killed.push([pid, sig]);
      },
    });
    assert.equal(result.reaped, true);
    assert.deepEqual(killed, [[-555, "SIGTERM"]], "the orphan's group is signalled");
    assert.equal(existsSync(pidFile), false, "the stale record is removed");
  });

  it("never kills a reused pid that now belongs to another program", () => {
    writeServerPidFile(pidFile, {
      pid: 556,
      execPath: "/opt/app/omniroute",
      script: "/opt/app/server.js",
    });
    const killed: number[] = [];
    const result = reapOrphanServer(pidFile, {
      platform: "linux",
      isAlive: () => true,
      commandLineOf: () => "/usr/bin/python3 /home/user/unrelated.py",
      killFn: (pid: number) => {
        killed.push(pid);
      },
    });
    assert.equal(result.reaped, false);
    assert.deepEqual(killed, []);
    assert.equal(existsSync(pidFile), false, "a foreign pid means the record is stale: remove it");
  });

  it("a dead pid just clears the record", () => {
    writeServerPidFile(pidFile, {
      pid: 557,
      execPath: "/opt/app/omniroute",
      script: "/opt/app/server.js",
    });
    const result = reapOrphanServer(pidFile, {
      platform: "linux",
      isAlive: () => false,
      commandLineOf: () => "",
      killFn: () => {
        throw new Error("must not be called");
      },
    });
    assert.equal(result.reaped, false);
    assert.equal(existsSync(pidFile), false);
  });

  it("win32: a matching orphan is reaped with taskkill /T", () => {
    writeServerPidFile(pidFile, {
      pid: 558,
      execPath: "C:\\App\\omniroute.exe",
      script: "C:\\App\\server.js",
    });
    const spawns: Array<{ cmd: string; args: string[] }> = [];
    const result = reapOrphanServer(pidFile, {
      platform: "win32",
      isAlive: () => true,
      commandLineOf: () => '"omniroute.exe","558","Console","1","120,000 K"',
      spawnFn: (cmd: string, args: string[]) => {
        spawns.push({ cmd, args });
        return { on: () => {} };
      },
    });
    assert.equal(result.reaped, true);
    assert.deepEqual(spawns, [{ cmd: "taskkill", args: ["/PID", "558", "/T", "/F"] }]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Electron main.js wires the detached spawn and the PID file (R-12)", () => {
  const main = readFileSync(join(import.meta.dirname, "../../electron/main.js"), "utf8");
  it("spawns the server with serverSpawnOptions(process.platform)", () => {
    assert.match(main, /\.\.\.serverSpawnOptions\(process\.platform\)/);
  });
  it("records the server pid after spawn and reaps an orphan before spawning", () => {
    assert.match(main, /writeServerPidFile\(/);
    assert.match(main, /reapOrphanServer\(/);
    assert.match(main, /removeServerPidFile\(/);
  });
});
