/**
 * catalogLocalCliGate.ts — folds the local-CLI availability probe (C-05) into the
 * catalog's blocked-provider gate.
 *
 * Local-CLI no-auth providers (auggie, devin-cli-agentic, zcode, codex-app-server) are
 * zero-config only while the CLI / app-server they drive exists on this machine;
 * otherwise every row they add fails at request time. The unavailable ones are added to
 * the same set as settings.blockedProviders so every listing loop of the build hides
 * them exactly like an operator-disabled provider. Free/web no-auth providers keep the
 * documented zero-config listing (#2798). Probe failure fails open.
 */

import {
  getUnavailableLocalCliProviderKeys,
  type LocalCliProbeContext,
} from "./catalogLocalCliAvailability";

export async function blockUnavailableLocalCliProviders(
  blockedProviders: Set<string>,
  context: LocalCliProbeContext
): Promise<void> {
  try {
    for (const key of await getUnavailableLocalCliProviderKeys(context)) {
      blockedProviders.add(key);
    }
  } catch (e) {
    console.log("[catalog] Could not probe local CLI providers:", e);
  }
}
