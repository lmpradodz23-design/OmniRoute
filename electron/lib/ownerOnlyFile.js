"use strict";

/**
 * ownerOnlyFile.js — write a secrets file readable by the current user only (E-7).
 *
 * `<DATA_DIR>/server.env` holds JWT_SECRET, STORAGE_ENCRYPTION_KEY and API_KEY_SECRET — the
 * keys that unlock the credential store. `fs.writeFileSync(path, data, "utf8")` inherits the
 * process umask (typically 0o644: world-readable). The `mode` option only applies when the
 * file is CREATED, so an already-existing file is tightened with `chmodSync` as well.
 * On Windows POSIX modes are a no-op (NTFS ACLs apply); the calls are harmless there.
 *
 * Pure (fs injectable) so it is unit-testable without the Electron binary.
 */
const fs = require("fs");

const OWNER_ONLY_MODE = 0o600;

/**
 * @param {string} filePath
 * @param {string} content
 * @param {{ writeFileSync?: typeof fs.writeFileSync, chmodSync?: typeof fs.chmodSync }} [io]
 */
function writeOwnerOnlyFile(filePath, content, io = {}) {
  const writeFileSync = io.writeFileSync || fs.writeFileSync;
  const chmodSync = io.chmodSync || fs.chmodSync;
  writeFileSync(filePath, content, { encoding: "utf8", mode: OWNER_ONLY_MODE });
  try {
    chmodSync(filePath, OWNER_ONLY_MODE);
  } catch {
    // Filesystems without POSIX modes (some network shares) — the create-time mode above is
    // the best effort available; never fail the bootstrap over it.
  }
}

module.exports = { writeOwnerOnlyFile, OWNER_ONLY_MODE };
