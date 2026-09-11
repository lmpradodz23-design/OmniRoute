import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";

import { planUninstall } from "./uninstallPlan.mjs";

const args = process.argv.slice(2);
const uninstallAlreadyInProgress =
  process.env.OMNIROUTE_SKIP_UNINSTALL_HOOK === "1" ||
  process.env.npm_lifecycle_event === "uninstall";

console.log("🛑 OmniRoute Uninstaller");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// 1. Decide what happens to the data directory BEFORE touching anything (J17: `--full`
//    is irreversible, so it needs `--yes` or an interactive typed confirmation).
const dataDir = process.env.DATA_DIR || path.join(os.homedir(), ".omniroute");
const plan = planUninstall({ argv: args, dataDir, isTTY: Boolean(process.stdin.isTTY) });
for (const line of plan.messages) console.log(line);

let eraseData = plan.eraseData;
if (plan.needsPrompt) {
  const answer = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(plan.prompt, (value) => {
      rl.close();
      resolve(value);
    });
  });
  eraseData = plan.confirmAnswer(answer);
  if (!eraseData) {
    console.log(`💾 Confirmation not given — keeping your data at: ${dataDir}`);
  }
} else if (plan.exitCode !== 0) {
  process.exit(plan.exitCode);
}

// 2. Stop PM2 process if it exists
try {
  console.log("Stopping and removing background PM2 processes...");
  execSync("pm2 delete omniroute 2>/dev/null", { stdio: "ignore" });
} catch {
  // It's perfectly fine if pm2 is not installed or the process doesn't exist.
}

// 3. Local AppData / Config Folder cleanup (only when the full uninstall was confirmed)
if (eraseData) {
  console.log(`🧹 Erasing database and files at: ${dataDir}`);
  try {
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      console.log("✅ Data directory removed.");
    } else {
      console.log("ℹ️ Data directory did not exist. Skipping.");
    }
  } catch (error) {
    console.warn("⚠️ Failed to remove data directory:", error.message);
  }
}

// 4. NPM uninstall
if (uninstallAlreadyInProgress) {
  console.log("ℹ️ npm uninstall is already in progress. Skipping nested uninstall command.");
} else {
  console.log("🗑️ Removing npm package...");
  try {
    execSync("npm uninstall -g omniroute", {
      stdio: "inherit",
      env: {
        ...process.env,
        OMNIROUTE_SKIP_UNINSTALL_HOOK: "1",
      },
    });
    console.log("\n✅ OmniRoute has been successfully uninstalled from your system.");
    if (!eraseData) {
      console.log(`ℹ️ Your configurations and databases were preserved in ${dataDir}.`);
    }
  } catch {
    console.warn(
      "⚠️ Failed to remove npm package. You might need to run this command with 'sudo'."
    );
  }
}
