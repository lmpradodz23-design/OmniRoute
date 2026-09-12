// Found by the real-provider E2E (tests/e2e/ollama-real-provider.test.ts): with the semantic
// cache on, a /v1/messages request stored its Anthropic-shaped response and the very next
// /v1/responses request with the same prompt got a "Semantic cache HIT" — an Anthropic body
// handed to an OpenAI Responses client. The cache stores the response ALREADY translated to
// the client's wire format, so the signature must be namespaced by that format.
import test from "node:test";
import assert from "node:assert/strict";

const {
  generateSignature,
  DEFAULT_CLIENT_FORMAT,
  extractSignatureContext,
  snapshotSignatureInputs,
  clearCache,
} = await import("../../src/lib/semanticCache.ts");
const { storeSemanticCacheResponse } =
  await import("../../open-sse/handlers/chatCore/semanticCacheStore.ts");
const { storeStreamingSemanticCacheResponse } =
  await import("../../open-sse/handlers/chatCore/streamingSemanticCacheStore.ts");
const { checkSemanticCache } = await import("../../open-sse/handlers/chatCore/semanticCache.ts");
const { sanitizeChatRequestBody } =
  await import("../../open-sse/handlers/chatCore/sanitization.ts");

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

// ── Regression after X-2 (branch fix/final-user-readiness): read/write signature symmetry ──
// chatCore computes the read-time signature from the body BEFORE the pipeline runs and the
// write-time signature AFTER it. sanitizeChatRequestBody() mutates that body in place (renames
// max_tokens ↔ max_output_tokens for the target format, swaps `tools` for sanitized schemas), and
// with those fields now in the signature context the reference snapshot chatCore kept made the
// two signatures diverge: the response was stored under a key no later request computed again.

function toolBody(): Record<string, unknown> {
  return {
    model: "m",
    messages: [{ role: "user", content: "ping" }],
    temperature: 0,
    max_tokens: 16,
    tools: [
      {
        type: "function",
        function: {
          name: "f",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ],
  };
}

function readArgs(body: Record<string, unknown>, sourceFormat: string) {
  return {
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
    sourceFormat,
  };
}

test("two identical requests from the same client and format share one signature and the second one HITs; another format MISSes", async () => {
  clearCache();
  const first = toolBody();
  const readSig = generateSignature(
    "m",
    first.messages,
    first.temperature as number,
    first.top_p as number | undefined,
    undefined,
    "openai",
    extractSignatureContext(first)
  );
  assert.equal(await checkSemanticCache(readArgs(first, "openai")), null, "cold cache: MISS");

  // What chatCore does between the read and the write, on the same object.
  const forWrite = snapshotSignatureInputs(first);
  sanitizeChatRequestBody(first, "openai", "openai-responses");
  storeSemanticCacheResponse({
    enabled: true,
    body: forWrite,
    headers: {},
    translatedResponse: {
      id: "c1",
      choices: [{ message: { role: "assistant", content: "pong" } }],
    },
    model: "m",
    sourceFormat: "openai",
  });

  const second = toolBody(); // byte-identical request, fresh object
  const secondSig = generateSignature(
    "m",
    second.messages,
    second.temperature as number,
    second.top_p as number | undefined,
    undefined,
    "openai",
    extractSignatureContext(second)
  );
  assert.equal(secondSig, readSig, "identical requests must compute identical signatures");
  const hit = await checkSemanticCache(readArgs(second, "openai"));
  assert.ok(hit?.success, "the identical request must be served from cache");
  const served = (await hit!.response.json()) as { choices: { message: { content: string } }[] };
  assert.equal(served.choices[0].message.content, "pong");

  assert.equal(
    await checkSemanticCache(readArgs(toolBody(), "claude")),
    null,
    "the same request from a different client format must MISS"
  );
  clearCache();
});

test("the write-side signature survives the in-place sanitization chatCore applies after the read (max_tokens rename, tool schema normalization)", () => {
  const body = toolBody();
  const readSig = generateSignature(
    "m",
    body.messages,
    0,
    undefined,
    undefined,
    "openai",
    extractSignatureContext(body)
  );
  const snapshot = snapshotSignatureInputs(body);
  sanitizeChatRequestBody(body, "openai", "openai-responses");

  // The hazard is real: the body object now carries a different context.
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_output_tokens, 16);
  assert.notEqual(
    generateSignature(
      "m",
      body.messages,
      0,
      undefined,
      undefined,
      "openai",
      extractSignatureContext(body)
    ),
    readSig,
    "precondition: hashing the mutated body would change the signature"
  );

  const record = (signatures: string[]) => ({
    isCacheableForWrite: () => true,
    isSmallEnoughForSemanticCache: () => true,
    generateSignature: (...a: Parameters<typeof generateSignature>) => {
      const sig = generateSignature(...a);
      signatures.push(sig);
      return sig;
    },
    setCachedResponse: () => {},
  });

  const nonStreaming: string[] = [];
  storeSemanticCacheResponse(
    {
      enabled: true,
      body: snapshot,
      headers: {},
      translatedResponse: { id: "c1" },
      model: "m",
      sourceFormat: "openai",
    },
    record(nonStreaming)
  );
  assert.deepEqual(
    nonStreaming,
    [readSig],
    "non-streaming store writes under the read-time signature"
  );

  const streaming: string[] = [];
  storeStreamingSemanticCacheResponse(
    {
      enabled: true,
      streamStatus: 200,
      streamResponseBody: { id: "c1", _streamed: true },
      body: snapshot,
      headers: {},
      model: "m",
      sourceFormat: "openai",
    },
    record(streaming)
  );
  assert.deepEqual(streaming, [readSig], "streaming store writes under the read-time signature");
});

test("snapshotSignatureInputs is immune to later mutation of the original body and keeps the read-time digest", () => {
  const body = toolBody();
  const readSig = generateSignature(
    "m",
    body.messages,
    0,
    undefined,
    undefined,
    "openai",
    extractSignatureContext(body)
  );
  const snapshot = snapshotSignatureInputs(body);
  (body.messages as unknown[]).push({ role: "assistant", content: "injected" });
  (body.tools as unknown[]).length = 0;
  delete body.max_tokens;
  const fromSnapshot = generateSignature(
    "m",
    snapshot.messages,
    snapshot.temperature,
    snapshot.top_p,
    undefined,
    "openai",
    extractSignatureContext(snapshot)
  );
  assert.equal(fromSnapshot, readSig);

  // Responses API `input` (string and array) and an omitted top_p go through unchanged.
  for (const input of [
    "hello",
    [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
  ]) {
    const responsesBody = { input, temperature: 0, instructions: "be brief" };
    const s = snapshotSignatureInputs(responsesBody);
    assert.equal(
      generateSignature(
        "m",
        s.messages,
        s.temperature,
        s.top_p,
        undefined,
        "openai-responses",
        extractSignatureContext(s)
      ),
      generateSignature(
        "m",
        input,
        0,
        undefined,
        undefined,
        "openai-responses",
        extractSignatureContext(responsesBody)
      )
    );
  }
});
