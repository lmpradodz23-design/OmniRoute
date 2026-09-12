// Fase 4 (audit/05-EXECUTION-PLAN.md): "logs/telemetria sem segredos" — the pino
// redaction safety net covered bearer/API keys but not session cookies nor the CLI
// token header, so a logged request/response header dump (or an error message quoting
// one) leaked the dashboard session or the CLI credential into the log files.
import { test } from "node:test";
import assert from "node:assert/strict";

import { redactLogArgs, redactSecrets } from "../../src/shared/utils/logRedaction.ts";

test("redactSecrets censors a request Cookie header value", () => {
  const out = redactSecrets(
    "upstream 401; cookie: omniroute_session=eyJhbGciOiJIUzI1NiJ9.payload.signature; theme=dark"
  );
  assert.match(out, /cookie: \[REDACTED\]/i);
  assert.doesNotMatch(out, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(out, /theme=dark/, "the whole cookie jar is censored, not one attribute");
});

test("redactSecrets censors a Set-Cookie header value", () => {
  const out = redactSecrets(
    'headers {"set-cookie":"omniroute_session=abcdef0123456789; Path=/; HttpOnly"}'
  );
  assert.match(out, /set-cookie":"\[REDACTED\]"/i);
  assert.doesNotMatch(out, /abcdef0123456789/);
});

test("redactSecrets censors the CLI token header", () => {
  const out = redactSecrets("x-omniroute-cli-token: 3f9a1c77b2e4d5f6a7b8c9d0 rejected");
  assert.match(out, /x-omniroute-cli-token: \[REDACTED\]/i);
  assert.doesNotMatch(out, /3f9a1c77b2e4d5f6a7b8c9d0/);
});

test("redactLogArgs censors cookies nested in structured log objects", () => {
  const [entry] = redactLogArgs([
    { headers: { cookie: "omniroute_session=zzzz9999yyyy8888; other=1" }, status: 500 },
  ]) as Array<{ headers: { cookie: string }; status: number }>;
  assert.equal(entry.headers.cookie, "[REDACTED]");
  assert.equal(entry.status, 500);
});

test("clean strings are returned untouched (hint fast path)", () => {
  const clean = "request finished in 12ms with status 200";
  assert.equal(redactSecrets(clean), clean);
});
