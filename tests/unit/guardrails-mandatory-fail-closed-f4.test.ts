// Fase 4 (audit/05-EXECUTION-PLAN.md, ordem 14): the security guardrails must be
// mandatory — not disableable by the request body or headers — and fail closed, and
// the three public endpoints must run one and the same guardrail pipeline.
//
// Before: `resolveDisabledGuardrails` merged apiKeyInfo + body.disabledGuardrails +
// body.metadata.disabledGuardrails + `x-omniroute-disabled-guardrails`, so ANY caller
// could switch off the credential masker, the PII masker or the prompt-injection guard
// with one header; and a guardrail that threw was recorded as "failed open" — a broken
// PII detector let the raw payload through to the provider.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BaseGuardrail,
  CredentialMaskerGuardrail,
  GuardrailRegistry,
  PIIMaskerGuardrail,
  PromptInjectionGuardrail,
  resolveDisabledGuardrails,
} from "../../src/lib/guardrails/index.ts";
import { VisionBridgeGuardrail } from "../../src/lib/guardrails/visionBridge.ts";
import { sanitizePII } from "../../src/lib/piiSanitizer.ts";

const quietLog = { warn() {}, debug() {}, info() {}, error() {} };

test("the security guardrails are mandatory; media bridges stay request-disableable", () => {
  assert.equal(new CredentialMaskerGuardrail().mandatory, true);
  assert.equal(new PIIMaskerGuardrail().mandatory, true);
  assert.equal(new PromptInjectionGuardrail().mandatory, true);
  assert.equal(new VisionBridgeGuardrail().mandatory, false);
  assert.equal(
    new BaseGuardrail("custom").mandatory,
    false,
    "mandatory is opt-in for custom rules"
  );
});

test("body and header disable lists cannot switch off a mandatory guardrail", () => {
  const disabled = resolveDisabledGuardrails(
    {
      body: {
        disabledGuardrails: ["credential-masker", "vision-bridge"],
        metadata: { disabledGuardrails: ["pii_masker"] },
      },
      headers: new Headers({ "x-omniroute-disabled-guardrails": "prompt-injection, audio-bridge" }),
    },
    { mandatory: ["credential-masker", "pii-masker", "prompt-injection"], log: quietLog }
  );
  assert.deepEqual(disabled, ["vision-bridge", "audio-bridge"]);
});

test("the default mandatory set comes from the registry's built-ins", () => {
  const disabled = resolveDisabledGuardrails({
    headers: {
      "x-disabled-guardrails": "credential-masker,pii-masker,prompt-injection,video-bridge",
    },
  });
  assert.deepEqual(disabled, ["video-bridge"]);
});

test("an operator's per-key policy may still disable a mandatory guardrail", () => {
  const disabled = resolveDisabledGuardrails({
    apiKeyInfo: { disabledGuardrails: ["pii-masker"] },
    body: { disabledGuardrails: ["credential-masker"] },
  });
  assert.deepEqual(disabled, ["pii-masker"]);
});

class ThrowingGuardrail extends BaseGuardrail {
  constructor(name: string, mandatory: boolean) {
    super(name, { mandatory });
  }
  override async preCall(): Promise<never> {
    throw new Error(`${this.name} detector unavailable`);
  }
  override async postCall(): Promise<never> {
    throw new Error(`${this.name} detector unavailable`);
  }
}

test("a mandatory guardrail that throws fails CLOSED on both stages", async () => {
  const registry = new GuardrailRegistry();
  registry.register(new ThrowingGuardrail("boom-mandatory", true));

  const pre = await registry.runPreCallHooks({ messages: [] }, { log: quietLog });
  assert.equal(pre.blocked, true);
  assert.equal(pre.guardrail, "boom-mandatory");
  assert.match(pre.message ?? "", /fail-closed|unavailable/i);
  assert.equal(pre.results[0]?.error, "boom-mandatory detector unavailable");

  const post = await registry.runPostCallHooks({ choices: [] }, { log: quietLog });
  assert.equal(post.blocked, true);
  assert.equal(post.guardrail, "boom-mandatory");
});

test("an optional guardrail that throws still fails open (documented contract)", async () => {
  const registry = new GuardrailRegistry();
  registry.register(new ThrowingGuardrail("boom-optional", false));
  const pre = await registry.runPreCallHooks({ messages: [] }, { log: quietLog });
  assert.equal(pre.blocked, false);
  assert.equal(pre.results[0]?.error, "boom-optional detector unavailable");
});

test("the three public endpoints share the one guardrail pipeline (parity)", () => {
  const routes = [
    "src/app/api/v1/chat/completions/route.ts",
    "src/app/api/v1/messages/route.ts",
    "src/app/api/v1/responses/route.ts",
  ];
  for (const route of routes) {
    const source = fs.readFileSync(path.join(process.cwd(), route), "utf8");
    assert.match(source, /import \{ handleChat \} from "@\/sse\/handlers\/chat"/, route);
    assert.match(source, /handleChat\(/, route);
  }
  const chat = fs.readFileSync(path.join(process.cwd(), "src/sse/handlers/chat.ts"), "utf8");
  const preCall = chat.slice(chat.indexOf("guardrailRegistry.runPreCallHooks("));
  const context = preCall.slice(0, preCall.indexOf("});") + 3);
  assert.match(context, /resolveDisabledGuardrails\(\{/);
  assert.match(context, /headers: request\.headers/);
  assert.match(context, /apiKeyInfo/);
});

test("PII sanitizer redacts a valid CPF, a Luhn-valid card number and an API token", () => {
  // Response-side PII sanitization is opt-in (see pii-opt-in-default.test.ts); this test
  // exercises the detectors, so it enables the feature explicitly for its own scope.
  const previous = process.env.PII_RESPONSE_SANITIZATION;
  process.env.PII_RESPONSE_SANITIZATION = "true";
  const input =
    "cliente CPF 529.982.247-25, cartão 4111 1111 1111 1111, chave token_fixture0123456789abcdefghij";
  let result: ReturnType<typeof sanitizePII>;
  try {
    result = sanitizePII(input);
  } finally {
    if (previous === undefined) delete process.env.PII_RESPONSE_SANITIZATION;
    else process.env.PII_RESPONSE_SANITIZATION = previous;
  }
  const { text, redacted } = result;
  assert.equal(redacted, true);
  assert.doesNotMatch(text, /529\.982\.247-25/);
  assert.doesNotMatch(text, /4111 1111 1111 1111/);
  assert.doesNotMatch(text, /token_fixture0123456789abcdefghij/);
  assert.match(text, /CPF_REDACTED/);
  assert.match(text, /CC_REDACTED/);
});
