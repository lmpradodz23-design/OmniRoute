import test from "node:test";
import assert from "node:assert/strict";
import {
  containsStrongCredentialToken,
  redactSensitiveErrorText,
} from "../../open-sse/utils/errorSanitization.ts";

// The "glued" secret-key shape (`<3+ alphanumerics>sk-…`) used to be matched by the regex
// alternative `[A-Za-z0-9]{3,}sk[-_]…`, which backtracks quadratically over long
// alphanumeric runs (the ReDoS guard in tests/unit/correctness/sanitizers.property.test.ts
// crossed its 250 ms budget on a loaded CI runner). The shape is now matched in linear
// time; these cases pin the contract that must not move while doing so.

test("glued secret keys are still redacted whole, including the alphanumeric prefix", () => {
  const out = redactSensitiveErrorText("token myappsk-abcdefghijklmnop rejected");
  assert.equal(out, "token [REDACTED] rejected");
  assert.equal(
    redactSensitiveErrorText("PROJ01SK_ABCDEFGHIJ12 expired"),
    "[REDACTED] expired",
    "case-insensitive like the union it replaced"
  );
  assert.ok(containsStrongCredentialToken("prefixsk-0123456789"));
});

test("a standalone sk- token and a two-character prefix behave as before", () => {
  assert.equal(redactSensitiveErrorText("key sk-abcdefghijklmnop leaked"), "key [REDACTED] leaked");
  // The old alternative required three or more prefix characters; a one- or two-character
  // prefix was never redacted by it, and the standalone alternative needs no prefix at all.
  assert.equal(redactSensitiveErrorText("absk-abcdefghijklmnop"), "absk-abcdefghijklmnop");
});

test("long alphanumeric runs without a secret are scanned in linear time", () => {
  const input = "a".repeat(4000) + "@" + "b".repeat(4000) + ".com " + "1".repeat(4000);
  redactSensitiveErrorText(input); // warm-up
  const start = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) redactSensitiveErrorText(input);
  const perCallMs = Number(process.hrtime.bigint() - start) / 1e6 / 5;
  // ~130 ms per call with the quadratic alternative; single-digit milliseconds linear.
  assert.ok(perCallMs < 60, `redactSensitiveErrorText took ${perCallMs.toFixed(1)} ms per call`);
});

test("a glued key at the end of a long alphanumeric run is still caught (linear worst case)", () => {
  const input = "x".repeat(3000) + "sk-abcdefghijklmnop";
  const out = redactSensitiveErrorText(input.slice(0, 4000));
  assert.ok(!out.includes("sk-abcdefghijklmnop"));
  assert.ok(out.endsWith("[REDACTED]"));
});
