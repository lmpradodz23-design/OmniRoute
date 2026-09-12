/**
 * Pure decision logic for scripts/build/uninstall.mjs (J17).
 *
 * `--full` erases the whole data directory (database, encrypted API keys, backups) and is
 * irreversible, so it is never executed on the strength of the flag alone:
 *   - scripted / non-interactive use must add the documented `--yes` flag;
 *   - interactive use must type the exact word ERASE at the prompt;
 *   - anything else keeps the data and exits with status 1 explaining how to confirm.
 * The plain uninstall always preserves the data directory and says where it is.
 */

export const CONFIRM_WORD = "ERASE";

/**
 * @param {{ argv?: string[]; dataDir: string; isTTY?: boolean }} input
 * @returns {{
 *   full: boolean;
 *   eraseData: boolean;
 *   needsPrompt: boolean;
 *   exitCode: number;
 *   dataDir: string;
 *   messages: string[];
 *   prompt: string | null;
 *   confirmAnswer: (answer: string) => boolean;
 * }}
 */
export function planUninstall({ argv = [], dataDir, isTTY = false }) {
  const full = argv.includes("--full");
  const preConfirmed = argv.includes("--yes");
  const confirmAnswer = (answer) => String(answer ?? "").trim() === CONFIRM_WORD;

  if (!full) {
    return {
      full: false,
      eraseData: false,
      needsPrompt: false,
      exitCode: 0,
      dataDir,
      prompt: null,
      confirmAnswer,
      messages: [
        `💾 Your data (database, API keys, backups) is kept intact at: ${dataDir}`,
        "   Run `npm run uninstall:full` if you also want it erased (asks for confirmation).",
      ],
    };
  }

  if (preConfirmed) {
    return {
      full: true,
      eraseData: true,
      needsPrompt: false,
      exitCode: 0,
      dataDir,
      prompt: null,
      confirmAnswer,
      messages: [`🧹 Full uninstall confirmed with --yes. Erasing everything at: ${dataDir}`],
    };
  }

  if (isTTY) {
    return {
      full: true,
      eraseData: false,
      needsPrompt: true,
      exitCode: 0,
      dataDir,
      prompt:
        `⚠️  Full uninstall PERMANENTLY erases ${dataDir}\n` +
        "   (database, provider connections, encrypted API keys, combos, usage history, backups).\n" +
        `   This cannot be undone. Type ${CONFIRM_WORD} to continue, anything else to keep your data: `,
      confirmAnswer,
      messages: [],
    };
  }

  return {
    full: true,
    eraseData: false,
    needsPrompt: false,
    exitCode: 1,
    dataDir,
    prompt: null,
    confirmAnswer,
    messages: [
      `⛔ Refusing to erase ${dataDir} without confirmation (no interactive terminal).`,
      "   Re-run with `npm run uninstall:full -- --yes` to confirm, or `npm run uninstall` to keep your data.",
    ],
  };
}
