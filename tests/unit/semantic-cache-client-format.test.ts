// Found by the real-provider E2E (tests/e2e/ollama-real-provider.test.ts): with the semantic
// cache on, a /v1/messages request stored its Anthropic-shaped response and the very next
// /v1/responses request with the same prompt got a "Semantic cache HIT" — an Anthropic body
// handed to an OpenAI Responses client. The cache stores the response ALREADY translated to
// the client's wire format, so the signature must be namespaced by that format.
import test from "node:test";
import assert from "node:assert/strict";

const { generateSignature, DEFAULT_CLIENT_FORMAT, extractSignatureContext } =
  await import("../../src/lib/semanticCache.ts");
const { storeSemanticCacheResponse } =
  await import("../../open-sse/handlers/chatCore/semanticCacheStore.ts");
const { checkSemanticCache } = await import("../../open-sse/handlers/chatCore/semanticCache.ts");

const prompt = [{ role: "user", content: "Responda apenas com a palavra PONG" }];

// Auditor B (cross-verification): the same turn under a different system prompt, tool set,
// response_format, reasoning budget or max_tokens shared one entry.
for (const [label, a, b] of [
  ["claude system", { system: "You are terse" }, { system: "You are verbose" }],
  ["openai tools vs none", { tools: [{ type: "function", function: { name: "f" } }] }, {}],
  [
    "openai response_format",
    { response_format: { type: "json_object" } },
    { response_format: { type: "text" } },
  ],
  ["responses instructions", { instructions: "a" }, { instructions: "b" }],
  [
    "claude thinking",
    { thinking: { type: "enabled", budget_tokens: 1024 } },
    { thinking: { type: "disabled" } },
  ],
  ["max_tokens", { max_tokens: 10 }, { max_tokens: 4000 }],
] as Array<[string, Record<string, unknown>, Record<string, unknown>]>) {
  test(`context that steers the answer changes the signature: ${label}`, () => {
    const sa = generateSignature(
      "m",
      prompt,
      0,
      1,
      undefined,
      "openai",
      extractSignatureContext(a)
    );
    const sb = generateSignature(
      "m",
      prompt,
      0,
      1,
      undefined,
      "openai",
      extractSignatureContext(b)
    );
    assert.notEqual(sa, sb);
  });
}

test("context key order does not change the signature; fields that do not steer are ignored", () => {
  const a = extractSignatureContext({
    tools: [{ a: 1, b: 2 }],
    system: "s",
    user: "u1",
    metadata: { x: 1 },
  });
  const b = extractSignatureContext({ system: "s", tools: [{ b: 2, a: 1 }], user: "u2" });
  assert.equal(
    generateSignature("m", prompt, 0, 1, undefined, "openai", a),
    generateSignature("m", prompt, 0, 1, undefined, "openai", b)
  );
  assert.equal(
    generateSignature("m", prompt, 0, 1, undefined, "openai", {}),
    generateSignature("m", prompt, 0, 1, undefined, "openai")
  );
});

test("a streamed request from a claude / responses client never gets a JSON cache HIT", async () => {
  const { setCachedResponse, clearCache } = await import("../../src/lib/semanticCache.ts");
  clearCache();
  const body = { messages: prompt, temperature: 0, top_p: 1 };
  for (const format of ["claude", "openai-responses"]) {
    setCachedResponse(
      generateSignature("m", prompt, 0, 1, undefined, format, extractSignatureContext(body)),
      "m",
      {
        type: "message",
      }
    );
    const hit = await checkSemanticCache({
      semanticCacheEnabled: true,
      body,
      clientRawRequest: { headers: {} },
      model: "m",
      provider: "openai-compatible",
      stream: true,
      reqLogger: { logConvertedResponse: () => {} },
      effectiveServiceTier: null,
      connectionId: null,
      startTime: Date.now(),
      log: null,
      persistAttemptLogs: () => {},
      sourceFormat: format,
    });
    assert.equal(hit, null, `${format} + stream must MISS (SSE cannot be synthesized for it)`);
  }
  clearCache();
});

test("the same prompt yields DIFFERENT signatures for different client formats", () => {
  const claude = generateSignature("m", prompt, 0, 1, undefined, "claude");
  const responses = generateSignature("m", prompt, 0, 1, undefined, "openai-responses");
  const chat = generateSignature("m", prompt, 0, 1, undefined, "openai");
  assert.notEqual(claude, responses);
  assert.notEqual(claude, chat);
  assert.notEqual(responses, chat);
});

test("omitting the format means chat completions, so existing callers stay deterministic", () => {
  assert.equal(DEFAULT_CLIENT_FORMAT, "openai");
  assert.equal(
    generateSignature("m", prompt, 0, 1),
    generateSignature("m", prompt, 0, 1, undefined, "openai")
  );
  assert.equal(generateSignature("m", prompt, 0, 1), generateSignature("m", prompt, 0, 1));
});

test("the non-streaming store passes the client format into the signature", () => {
  const seen: unknown[][] = [];
  storeSemanticCacheResponse(
    {
      enabled: true,
      body: { messages: prompt, temperature: 0, top_p: 1 },
      headers: {},
      translatedResponse: { type: "message", content: [{ type: "text", text: "PONG" }] },
      model: "m",
      sourceFormat: "claude",
    },
    {
      isCacheableForWrite: () => true,
      isSmallEnoughForSemanticCache: () => true,
      generateSignature: (...a: unknown[]) => {
        seen.push(a);
        return "sig";
      },
      setCachedResponse: () => {},
    }
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0][5], "claude", "6th argument is the client format");
});

test("a body cached for a /v1/messages client is NOT served to a /v1/responses client", async () => {
  const { setCachedResponse, clearCache } = await import("../../src/lib/semanticCache.ts");
  clearCache();
  const body = { messages: prompt, temperature: 0, top_p: 1 };
  const claudeSig = generateSignature("m", prompt, 0, 1, undefined, "claude");
  setCachedResponse(claudeSig, "m", { type: "message", content: [{ type: "text", text: "PONG" }] });
  const common = {
    semanticCacheEnabled: true,
    body,
    clientRawRequest: { headers: {} },
    model: "m",
    provider: "openai-compatible",
    stream: false,
    reqLogger: { logConvertedResponse: () => {} },
    effectiveServiceTier: null,
    connectionId: null,
    startTime: Date.now(),
    log: null,
    persistAttemptLogs: () => {},
  };
  const forResponses = await checkSemanticCache({ ...common, sourceFormat: "openai-responses" });
  assert.equal(forResponses, null, "a Responses client must MISS on an Anthropic-shaped entry");
  const forClaude = await checkSemanticCache({ ...common, sourceFormat: "claude" });
  assert.ok(forClaude?.success, "the client that stored it still HITs");
  clearCache();
});
