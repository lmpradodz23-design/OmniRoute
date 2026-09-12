/**
 * Windows default install location of the Tailscale binaries.
 *
 * Resolved at RUNTIME from %ProgramFiles% — never a module-level absolute-path string
 * literal. Two reasons:
 *  1. Turbopack's output-file tracer treats a literal absolute path that reaches
 *     `fs.existsSync` as a build-time file reference and, when that path exists on the
 *     build host, tries to copy it into the standalone bundle:
 *       Failed to copy traced files for .../api/tunnels/tailscale/check/route.js
 *       ENOENT mkdir '.../standalone/C:/Program Files/Tailscale'
 *  2. %ProgramFiles% is the correct answer on systems whose Windows drive is not C:.
 * Exported (via tailscaleTunnel.ts) for the regression test
 * tests/unit/tailscale-windows-default-path.test.ts.
 */
import path from "path";

export function getWindowsDefaultTailscaleBinaries(): { tailscale: string; tailscaled: string } {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const dir = path.join(programFiles, "Tailscale");
  return {
    tailscale: path.join(dir, "tailscale.exe"),
    tailscaled: path.join(dir, "tailscaled.exe"),
  };
}
