// DefaultExecutor.buildUrl for provider ids that are NOT in PROVIDERS (R-17 / #3197).
// Split out of executor-default-base.test.ts (file-size gate); no case was removed.
import test from "node:test";
import assert from "node:assert/strict";

import { DefaultExecutor } from "../../open-sse/executors/default.ts";
import { PROVIDERS } from "../../open-sse/config/constants.ts";

test("DefaultExecutor inherits the OpenAI config shape for unknown providers but never their endpoint (R-17)", () => {
  const executor = new DefaultExecutor("unknown-provider");
  // The config fallback keeps format/header defaults usable for OpenAI-compatible gateways…
  assert.equal(executor.config.baseUrl, PROVIDERS.openai.baseUrl);
  // …but with no base URL of its own, the request must fail instead of carrying this
  // provider's credentials to api.openai.com.
  assert.throws(() => executor.buildUrl("gpt-4.1", true), /Unknown provider "unknown-provider"/);
  assert.equal(
    executor.buildUrl("gpt-4.1", true, 0, {
      providerSpecificData: { baseUrl: "https://gateway.example.test/v1" },
    }),
    "https://gateway.example.test/v1/chat/completions"
  );
});

test("DefaultExecutor.buildUrl resolves a local provider absent from PROVIDERS to its localDefault, never OpenAI", () => {
  // llama-cpp lives only in LOCAL_PROVIDERS: the constructor still borrows the OpenAI config
  // shape (#3197), but the URL comes from the catalogue's localDefault.
  const executor = new DefaultExecutor("llama-cpp");
  assert.equal(executor.config.baseUrl, PROVIDERS.openai.baseUrl);
  const url = executor.buildUrl("qwen", true, 0, { providerSpecificData: {} });
  assert.match(url, /^http:\/\/127\.0\.0\.1:8080\/v1/);
  assert.doesNotMatch(url, /api\.openai\.com/);
});
