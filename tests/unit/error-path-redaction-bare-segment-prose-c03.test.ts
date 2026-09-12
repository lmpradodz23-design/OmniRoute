// Final audit C-03: the path redactor treated `/models unavailable. Provide a Model ID …`
// as an unquoted filesystem path with whitespace and failed closed over the whole
// sentence, so the provider wizard rendered the connection-test failure as the
// unreadable "Endpoint <path>". A bare single-segment POSIX token (`/word`) that is
// followed by ordinary prose (no later token carrying filesystem evidence) is route/
// API text, not a filesystem path. Real paths — known POSIX roots, multi-segment
// paths, extension-bearing files, Windows drives — must keep redacting exactly as before.
import test from "node:test";
import assert from "node:assert/strict";
import { redactErrorPaths } from "../../open-sse/utils/errorPathRedaction.ts";
import { sanitizeErrorMessage } from "../../open-sse/utils/errorSanitization.ts";

const AUDIT_PHRASE =
  "Endpoint /models unavailable. Provide a Model ID to validate via /chat/completions.";

test("C-03: the exact validator phrase keeps its sentence instead of collapsing to `Endpoint <path>`", () => {
  for (const redact of [redactErrorPaths, sanitizeErrorMessage]) {
    const out = redact(AUDIT_PHRASE);
    assert.notEqual(out, "Endpoint <path>");
    assert.ok(
      out.startsWith("Endpoint /models unavailable. Provide a Model ID to validate via "),
      `sentence must survive redaction, got: ${JSON.stringify(out)}`
    );
  }
});

test("C-03: a bare `/segment` followed by prose is not a filesystem path", () => {
  assert.equal(redactErrorPaths("Endpoint /models unavailable"), "Endpoint /models unavailable");
  assert.equal(
    redactErrorPaths("Endpoint /models unavailable. Provide a Model ID to validate."),
    "Endpoint /models unavailable. Provide a Model ID to validate."
  );
  assert.equal(
    sanitizeErrorMessage("Endpoint /models returned an empty body, retry later"),
    "Endpoint /models returned an empty body, retry later"
  );
});

test("C-03: real filesystem paths are still redacted (POSIX roots, multi-segment, extensions, Windows)", () => {
  assert.equal(
    redactErrorPaths("open /home/x/.omniroute/storage.sqlite failed"),
    "open <path> failed"
  );
  const windows = redactErrorPaths(
    "Module not found: C:\\Users\\zodyp\\.omniroute\\storage.sqlite is locked"
  );
  assert.doesNotMatch(windows, /Users|zodyp|storage\.sqlite/);
  assert.match(windows, /<path>/);

  // Multi-segment extensionless path with whitespace: still fails closed (no suffix leak).
  const spaced = redactErrorPaths("Provider failed at /custom/internal secret directory");
  assert.doesNotMatch(spaced, /custom\/internal|secret directory/);
  assert.match(spaced, /<path>/);

  // A bare segment whose remainder carries filesystem evidence is still a path.
  const withFile = redactErrorPaths("Provider failed at /vault my secret file.txt is missing");
  assert.doesNotMatch(withFile, /vault|file\.txt/);
  assert.match(withFile, /<path>/);

  // Known POSIX roots never become prose, even as a single segment followed by words.
  const knownRoot = redactErrorPaths("Provider failed at /etc secret config");
  assert.doesNotMatch(knownRoot, /\/etc/);
  assert.match(knownRoot, /<path>/);

  // Existing single-segment invariants (end of line / clear prose boundary) are unchanged.
  assert.equal(
    redactErrorPaths("Provider failed opening /vault"),
    "Provider failed opening <path>"
  );
  assert.equal(
    redactErrorPaths("Failed /vault then GET /home/profile returned 404"),
    "Failed <path> then GET /home/profile returned 404"
  );
});
