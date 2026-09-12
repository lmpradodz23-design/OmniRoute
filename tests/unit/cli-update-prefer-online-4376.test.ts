import test from "node:test";
import assert from "node:assert/strict";

const update = await import("../../bin/cli/commands/update.mjs");
// The CLI resolves the npm binary per platform (`npm` on POSIX, `npm.cmd` on Windows — see
// #5542 / nodejs/node#52554); assert against that helper, not a hard-coded "npm".
const { npmBin } = await import("../../bin/cli/npm-exec.mjs");

// #4376: `omniroute update` reported "Latest version: 3.8.30" while npm's `latest`
// dist-tag was already 3.8.31, so it told users on an old build they were "running
// the latest version". Root cause: getLatestVersion() ran `npm view omniroute version`
// without `--prefer-online`, so npm served a stale value from its HTTP cache.
// The fix forces npm to revalidate the cache against the registry.
test("getLatestVersion passes --prefer-online to bypass the stale npm cache (#4376)", async () => {
  let capturedArgs = null;
  const fakeExec = async (cmd: string, args: string[]) => {
    capturedArgs = { cmd, args };
    // Fase 8: `version` + `repository.url` are requested together (`--json` → object) so
    // the CLI can verify the package is published from this repository.
    return {
      stdout: `${JSON.stringify({
        version: "3.8.31",
        "repository.url": "https://github.com/LMPrado-DZ23/OmniRoute",
      })}\n`,
    };
  };
  const latest = await update.getLatestVersion(fakeExec);
  assert.equal(latest, "3.8.31");
  assert.ok(capturedArgs, "exec must be invoked");
  assert.equal(capturedArgs.cmd, npmBin());
  assert.ok(
    capturedArgs.args.includes("--prefer-online"),
    `expected --prefer-online in npm args, got: ${JSON.stringify(capturedArgs.args)}`
  );
  // still the right query
  assert.ok(capturedArgs.args.includes("view"));
  assert.ok(capturedArgs.args.includes("omniroute"));
  assert.ok(capturedArgs.args.includes("version"));
});

test("getLatestVersion returns null when npm is unavailable (#4376)", async () => {
  const latest = await update.getLatestVersion(async () => {
    throw new Error("npm not found");
  });
  assert.equal(latest, null);
});
