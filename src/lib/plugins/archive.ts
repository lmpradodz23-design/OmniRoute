/**
 * Safe extraction of a marketplace plugin archive (P-4 of the readiness audit).
 *
 * A `.tar.gz` downloaded from a registry is untrusted input. This extractor is fail-closed:
 *   - only regular files and directories are unpacked — symlinks, hard links, devices and
 *     FIFOs are refused (a symlink pointing outside the target is the classic escape);
 *   - entry paths must be relative, without `..` segments, backslashes or NUL bytes
 *     (checked on the raw archive path, before node-tar's own normalisation);
 *   - entry count, per-entry size and total size are bounded (decompression bombs);
 *   - the result must contain `plugin.json` at the root or inside exactly one top-level
 *     folder (the usual `name-version/` layout) — anything else is not a plugin.
 * Any violation throws a `PluginArchiveError`; the caller removes the target directory.
 *
 * @module plugins/archive
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";

export type PluginArchiveErrorCode =
  "FORMAT" | "ENTRY_TYPE" | "PATH" | "TOO_MANY_ENTRIES" | "TOO_LARGE" | "NO_MANIFEST";

export class PluginArchiveError extends Error {
  constructor(
    public readonly code: PluginArchiveErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PluginArchiveError";
  }
}

export interface PluginArchiveLimits {
  /** Maximum number of entries (files + directories). */
  maxEntries?: number;
  /** Maximum total uncompressed bytes across all files. */
  maxTotalBytes?: number;
  /** Maximum uncompressed bytes of a single file. */
  maxEntryBytes?: number;
}

export const DEFAULT_PLUGIN_ARCHIVE_LIMITS: Required<PluginArchiveLimits> = {
  maxEntries: 2_000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEntryBytes: 16 * 1024 * 1024,
};

const ALLOWED_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory"]);

/** True when an archive path could land outside the target directory. */
export function isUnsafeArchivePath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes("\0")) return true;
  if (entryPath.includes("\\")) return true; // Windows separator smuggling
  if (path.posix.isAbsolute(entryPath) || /^[A-Za-z]:/.test(entryPath)) return true;
  return entryPath.split("/").some((segment) => segment === "..");
}

export interface ExtractedPluginArchive {
  /** Directory that contains `plugin.json`. */
  pluginDir: string;
  entries: number;
  bytes: number;
}

async function locatePluginDir(destDir: string): Promise<string> {
  const rootManifest = path.join(destDir, "plugin.json");
  try {
    if ((await stat(rootManifest)).isFile()) return destDir;
  } catch {
    /* not at the root — try the single-folder layout */
  }
  const dirs: string[] = [];
  for (const entry of await readdir(destDir, { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(entry.name);
  }
  if (dirs.length === 1) {
    const nested = path.join(destDir, dirs[0]);
    try {
      if ((await stat(path.join(nested, "plugin.json"))).isFile()) return nested;
    } catch {
      /* fall through */
    }
  }
  throw new PluginArchiveError(
    "NO_MANIFEST",
    "Plugin archive has no plugin.json at its root or inside a single top-level folder"
  );
}

/**
 * Extract `archivePath` (tar.gz) into `destDir` under the fail-closed policy above and return
 * the directory holding `plugin.json`. Throws `PluginArchiveError` on any violation; partial
 * output may remain in `destDir` — the caller owns and removes that directory.
 */
export async function extractPluginArchive(
  archivePath: string,
  destDir: string,
  limits: PluginArchiveLimits = {}
): Promise<ExtractedPluginArchive> {
  const lim = { ...DEFAULT_PLUGIN_ARCHIVE_LIMITS, ...limits };
  let entries = 0;
  let bytes = 0;
  let violation: PluginArchiveError | null = null;

  const refuse = (code: PluginArchiveErrorCode, message: string): false => {
    if (!violation) violation = new PluginArchiveError(code, message);
    return false;
  };

  // node-tar consults `filter` in the parser, i.e. on the RAW header path, before its own
  // absolute/`..` normalisation — so an escaping entry is refused here, never written.
  const filter = (entryPath: string, entry: tar.ReadEntry): boolean => {
    if (violation) return false;
    if ((entry as unknown as { meta?: boolean }).meta) return true; // pax / long-name headers carry no file
    const type = String(entry.type);
    if (!ALLOWED_TYPES.has(type)) {
      return refuse(
        "ENTRY_TYPE",
        `Plugin archive entry "${entryPath}" is a ${type}; only files and directories are allowed`
      );
    }
    if (isUnsafeArchivePath(entryPath) || isUnsafeArchivePath(String(entry.path))) {
      return refuse(
        "PATH",
        `Plugin archive entry "${entryPath}" would escape the target directory`
      );
    }
    entries += 1;
    if (entries > lim.maxEntries) {
      return refuse("TOO_MANY_ENTRIES", `Plugin archive has more than ${lim.maxEntries} entries`);
    }
    const size = Number(entry.size ?? 0);
    if (size > lim.maxEntryBytes) {
      return refuse(
        "TOO_LARGE",
        `Plugin archive entry "${entryPath}" exceeds ${lim.maxEntryBytes} bytes`
      );
    }
    bytes += size;
    if (bytes > lim.maxTotalBytes) {
      return refuse("TOO_LARGE", `Plugin archive exceeds ${lim.maxTotalBytes} bytes uncompressed`);
    }
    return true;
  };

  try {
    await tar.x({
      file: archivePath,
      cwd: destDir,
      filter,
      preservePaths: false,
      strict: true,
      // never restore ownership/setuid bits from the archive
      preserveOwner: false,
      noChmod: true,
    });
  } catch (err) {
    if (violation) throw violation;
    const message = err instanceof Error ? err.message : String(err);
    throw new PluginArchiveError("FORMAT", `Plugin archive is not a valid tar.gz: ${message}`);
  }
  if (violation) throw violation;

  const pluginDir = await locatePluginDir(destDir);
  return { pluginDir, entries, bytes };
}
