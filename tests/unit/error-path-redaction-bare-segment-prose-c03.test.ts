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

// Public API routes are not filesystem paths. The chat handler's #6457 hint
// ("… cannot be used on /v1/chat/completions. Use POST /v1/images/generations
// instead.") and the model-sync "Invalid JSON response from /models" message
// name routes the caller needs; the redactor must keep them while real
// filesystem paths in the same sentence are still redacted.
test("public API routes (/v1/*, /api/*, /models) survive redaction; filesystem paths beside them do not", () => {
  const chatHint =
    "Model 'x' is an image-generation model and cannot be used on /v1/chat/completions. " +
    "Use POST /v1/images/generations instead.";
  for (const redact of [redactErrorPaths, sanitizeErrorMessage]) {
    assert.equal(redact(chatHint), chatHint);
    assert.equal(
      redact("Invalid JSON response from /models"),
      "Invalid JSON response from /models"
    );
    assert.equal(
      redact("GET /api/providers/abc/models returned 502"),
      "GET /api/providers/abc/models returned 502"
    );
    assert.equal(redact("Route '/v1/models' not found"), "Route '/v1/models' not found");
  }

  // A filesystem path next to a public route keeps redacting, and the route survives.
  assert.equal(
    redactErrorPaths("/v1/chat/completions failed: ENOENT open '/home/op/.omniroute/config.json'"),
    "/v1/chat/completions failed: ENOENT open '<path>'"
  );
  assert.equal(
    redactErrorPaths("cannot open /home/op/.omniroute/storage.sqlite then retry /v1/models"),
    "cannot open <path> then retry /v1/models"
  );
  const windows = redactErrorPaths(
    "Sync via /api/providers/x/models read C:\\Users\\op\\.omniroute\\models.json"
  );
  assert.equal(windows, "Sync via /api/providers/x/models read <path>");

  // Only the public route roots are exempt: an unknown extensionless multi-segment
  // token (`/custom/internal`) and a bare `/vault` at end of line stay fail-closed.
  assert.match(redactErrorPaths("Provider failed at /custom/internal secret directory"), /<path>/);
  assert.equal(
    redactErrorPaths("Provider failed opening /vault"),
    "Provider failed opening <path>"
  );
});
