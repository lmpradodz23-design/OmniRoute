"use strict";

// Cross-platform "kill the whole process tree" helper (#3347, R-12).
//
// The embedded server is spawned via process.execPath (= omniroute.exe) with
// ELECTRON_RUN_AS_NODE=1, and it in turn spawns grandchildren (embedded services,
// MITM proxy, tunnels — several also omniroute.exe-as-node).
//
// Windows: Node's ChildProcess.kill()/SIGTERM/SIGKILL only terminate the DIRECT child via
// TerminateProcess — they do NOT walk the tree. Surviving grandchildren keep a lock on
// omniroute.exe, so the process "hangs in memory" after Exit and updates fail with
// "file in use". Windows needs `taskkill /PID <pid> /T /F` (/T terminates descendants).
//
// POSIX: `proc.kill(signal)` signals ONE pid — it does not walk the tree either, and it
// only reaches a process group when the child was spawned `detached` (its own group) and
// the signal goes to `-pid`. main.js spawns the server with serverSpawnOptions() so the
// group kill below reaches every grandchild (R-12 / E-6).
//
// PID file: if the Electron main process itself dies (crash, SIGKILL, updater), the
// detached server keeps running with nothing tracking it. main.js records the server pid
// in DATA_DIR/server.pid and reaps a still-running orphan at the next launch — only after
// verifying the pid still belongs to OUR server (pids get reused), never blindly.

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Spawn options that make the server tree killable as a unit.
 * @param {string} platform
 */
function serverSpawnOptions(platform) {
  // POSIX: own process group (pgid = pid) so `kill(-pid)` reaches grandchildren.
  // win32: `detached` would allocate a new console group; taskkill /T already walks
  // the tree, so keep the child attached.
  return { detached: platform !== "win32" };
}

/**
 * Terminate a child process and all of its descendants.
 * @param {{ pid?: number, kill?: (signal?: string) => void } | null | undefined} proc
 * @param {{ platform?: string, signal?: string, spawnFn?: typeof spawn, killFn?: (pid: number, signal: string) => void }} [options]
 */
function killProcessTree(proc, options = {}) {
  if (!proc || proc.pid == null) return;
  const platform = options.platform || process.platform;
  const signal = options.signal || "SIGTERM";

  if (platform === "win32") {
    const spawnFn = options.spawnFn || spawn;
    try {
      // Array args + no shell → the pid (an integer we own) is never interpolated into a
      // shell command string (Hard Rule #13). /T walks the tree, /F forces termination.
      const killer = spawnFn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
      });
      if (killer && typeof killer.on === "function") {
        killer.on("error", () => {
          try {
            proc.kill(signal);
          } catch {
            /* already dead */
          }
        });
      }
    } catch {
      // taskkill unavailable (rare) — fall back to the direct kill.
      try {
        proc.kill(signal);
      } catch {
        /* already dead */
      }
    }
    return;
  }

  // POSIX: signal the whole process group of the detached server (pgid = pid). If the
  // child was not detached (ESRCH on the group) or we lack permission, fall back to the
  // direct kill so the server itself still stops.
  const killFn = options.killFn || process.kill;
  try {
    killFn(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      /* already dead */
    }
  }
}

/**
 * @param {string} pidFile
 * @param {{ pid: number, execPath: string, script: string }} record
 */
function writeServerPidFile(pidFile, record) {
  const payload = {
    pid: record.pid,
    execPath: record.execPath,
    script: record.script,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(pidFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

/**
 * @param {string} pidFile
 * @returns {{ pid: number, execPath?: string, script?: string, startedAt?: string } | null}
 */
function readServerPidFile(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    if (!parsed || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {string | null | undefined} pidFile */
function removeServerPidFile(pidFile) {
  if (!pidFile) return;
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    /* best effort */
  }
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user — alive, but not ours.
    return error && error.code === "EPERM";
  }
}

/** Command line (POSIX) or tasklist CSV row (win32) for a pid; "" when unavailable. */
function defaultCommandLineOf(pid, platform) {
  try {
    if (platform === "win32") {
      return execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
    }
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

/**
 * Does the live process behind `pid` still look like the server we recorded? Pids are
 * reused, so a record alone is never enough to kill.
 */
function matchesRecordedServer(commandLine, record, platform) {
  if (!commandLine) return false;
  const base = platform === "win32" ? path.win32.basename : path.posix.basename;
  const needles = [record.script, record.execPath]
    .filter((value) => typeof value === "string" && value.length > 0)
    .flatMap((value) => [value, base(value)])
    .filter((value) => value.length > 0);
  const haystack = commandLine.toLowerCase();
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

/**
 * Reap a server left behind by a previous main process that died. Always clears the
 * record; kills only a live pid whose command line still matches the recorded server.
 * @param {string} pidFile
 * @param {{ platform?: string, isAlive?: (pid: number) => boolean, commandLineOf?: (pid: number, platform: string) => string, killFn?: (pid: number, signal: string) => void, spawnFn?: typeof spawn, log?: (message: string) => void }} [options]
 * @returns {{ reaped: boolean, pid: number | null }}
 */
function reapOrphanServer(pidFile, options = {}) {
  const platform = options.platform || process.platform;
  const log = options.log || ((message) => console.warn(message));
  const record = readServerPidFile(pidFile);
  if (!record) return { reaped: false, pid: null };
  removeServerPidFile(pidFile);

  const isAlive = options.isAlive || defaultIsAlive;
  if (!isAlive(record.pid)) return { reaped: false, pid: record.pid };

  const commandLineOf = options.commandLineOf || defaultCommandLineOf;
  if (!matchesRecordedServer(commandLineOf(record.pid, platform), record, platform)) {
    log(
      `[Electron] Stale server.pid ${record.pid} now belongs to another program; not touching it.`
    );
    return { reaped: false, pid: record.pid };
  }

  log(
    `[Electron] Reaping orphaned embedded server (pid ${record.pid}, started ${record.startedAt || "unknown"}) left by a previous session.`
  );
  const proc = {
    pid: record.pid,
    kill: (signal) => (options.killFn || process.kill)(record.pid, signal),
  };
  killProcessTree(proc, {
    platform,
    signal: "SIGTERM",
    spawnFn: options.spawnFn,
    killFn: options.killFn,
  });
  return { reaped: true, pid: record.pid };
}

module.exports = {
  killProcessTree,
  serverSpawnOptions,
  writeServerPidFile,
  readServerPidFile,
  removeServerPidFile,
  reapOrphanServer,
  matchesRecordedServer,
};
