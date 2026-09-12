/**
 * R-17: a provider id outside every catalog inherits PROVIDERS.openai as its config
 * (DefaultExecutor constructor fallback), which used to send that provider's credentials
 * to api.openai.com. Without a connection-supplied base URL the request must fail
 * explicitly instead of falling back to the OpenAI default endpoint.
 */
import { PROVIDERS } from "../../config/constants.ts";
import type { RegistryEntry } from "../../config/providerRegistry.ts";
import { LOCAL_PROVIDERS } from "@/shared/constants/providers";

export function assertKnownProviderBaseUrl(
  provider: string,
  registryEntry: RegistryEntry | null
): void {
  if (!PROVIDERS[provider] && !registryEntry && !LOCAL_PROVIDERS[provider]) {
    throw new Error(
      `Unknown provider "${provider}": no base URL configured — refusing to fall back ` +
        `to the OpenAI default endpoint with this provider's credentials`
    );
  }
}
