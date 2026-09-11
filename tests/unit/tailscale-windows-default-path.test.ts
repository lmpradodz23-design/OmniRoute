import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWindowsDefaultTailscaleBinaries } from "../../src/lib/tailscaleTunnel";

// Regression guard for the Turbopack standalone warning
//   Failed to copy traced files for .../api/tunnels/tailscale/check/route.js
//   Error: ENOENT: no such file or directory, mkdir '.../standalone/C:/Program Files/Tailscale'
// Root cause: a module-level absolute-path string literal ("C:\\Program Files\\Tailscale\\...")
// reaching fs.existsSync. The tracer treats it as a file reference and, on a build host where
// Tailscale is installed, tries to copy it into the bundle. The path must be built at runtime.

const modulePath = fileURLToPath(new URL("../../src/lib/tailscaleTunnel.ts", import.meta.url));
const source = fs.readFileSync(modulePath, "utf8");

test("tailscaleTunnel has no module-level absolute Windows path literal for the tracer to follow", () => {
  const offenders = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .filter((line) => /^const\s+\w+\s*=\s*"[A-Za-z]:\\\\/.test(line));
  assert.deepEqual(
    offenders,
    [],
    `module-level absolute path literal(s): ${offenders.join(" | ")}`
  );
});

test("Windows default Tailscale binaries are resolved from %ProgramFiles% at runtime", () => {
  const saved = process.env.ProgramFiles;
  try {
    process.env.ProgramFiles = "D:\\Apps";
    const custom = getWindowsDefaultTailscaleBinaries();
    assert.equal(custom.tailscale, path.join("D:\\Apps", "Tailscale", "tailscale.exe"));
    assert.equal(custom.tailscaled, path.join("D:\\Apps", "Tailscale", "tailscaled.exe"));

    delete process.env.ProgramFiles;
    const fallback = getWindowsDefaultTailscaleBinaries();
    assert.equal(fallback.tailscale, path.join("C:\\Program Files", "Tailscale", "tailscale.exe"));
    assert.equal(
      fallback.tailscaled,
      path.join("C:\\Program Files", "Tailscale", "tailscaled.exe")
    );
  } finally {
    if (saved === undefined) delete process.env.ProgramFiles;
    else process.env.ProgramFiles = saved;
  }
});
