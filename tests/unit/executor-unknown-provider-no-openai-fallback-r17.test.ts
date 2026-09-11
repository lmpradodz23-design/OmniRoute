// R-17 (audit/02-ARCHITECTURE.md): DefaultExecutor falls back to PROVIDERS.openai for a
// provider id it does not know, so an unknown provider with no base URL of its own was
// silently routed to https://api.openai.com — with that provider's credentials in the
// Authorization header. An unknown provider must fail explicitly unless the connection
// carries its own base URL.
import test from "node:test";
import assert from "node:assert/strict";

const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");

test("an unknown provider without a base URL refuses to build the OpenAI default URL", () => {
  const executor = new DefaultExecutor("totally-unknown-provider-r17");
  assert.throws(
    () => executor.buildUrl("some-model", false, 0, { providerSpecificData: {} } as never),
    /unknown provider|no base URL/i
  );
});

test("an unknown provider with its own base URL is honoured", () => {
  const executor = new DefaultExecutor("totally-unknown-provider-r17");
  const url = executor.buildUrl("some-model", false, 0, {
    providerSpecificData: { baseUrl: "https://gateway.example.test/v1" },
  } as never);
  assert.match(url, /^https:\/\/gateway\.example\.test\/v1/);
  assert.doesNotMatch(url, /api\.openai\.com/);
});

test("the built-in openai provider still resolves its default endpoint", () => {
  const executor = new DefaultExecutor("openai");
  const url = executor.buildUrl("gpt-4.1", false, 0, { providerSpecificData: {} } as never);
  assert.match(url, /api\.openai\.com/);
});
