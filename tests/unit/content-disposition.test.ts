/**
 * P-6 (audit/03 §2.3): `GET /api/files/{id}/content` interpolated the stored (user-controlled)
 * filename straight into `Content-Disposition`. A `"` closed the quoted string, CR/LF split
 * the response, and non-ASCII names were emitted raw. `contentDispositionAttachment` yields an
 * ASCII-safe quoted fallback plus the RFC 5987 `filename*` form.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { contentDispositionAttachment } from "../../src/shared/utils/contentDisposition.ts";

test("plain ASCII names pass through in both forms", () => {
  assert.equal(
    contentDispositionAttachment("report.pdf"),
    `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
  );
});

test("quotes and backslashes cannot break out of the quoted fallback", () => {
  const value = contentDispositionAttachment('a"b\\c.txt');
  assert.match(value, /^attachment; filename="a_b_c\.txt"; filename\*=UTF-8''a%22b%5Cc\.txt$/);
});

test("CR/LF and other control characters are stripped (no header injection)", () => {
  const value = contentDispositionAttachment("x.txt\r\nSet-Cookie: pwned=1");
  assert.ok(!/[\r\n]/.test(value), "no line breaks may survive");
  assert.ok(!value.includes("Set-Cookie:"), "the injected header must not appear verbatim");
  assert.match(value, /^attachment; filename="x\.txtSet-Cookie_ pwned=1"; filename\*=UTF-8''/);
});

test("non-ASCII names get an ASCII placeholder and a percent-encoded extended value", () => {
  const value = contentDispositionAttachment("relatório ção.pdf");
  assert.match(value, /filename="relat_rio __o\.pdf"/);
  assert.match(value, /filename\*=UTF-8''relat%C3%B3rio%20%C3%A7%C3%A3o\.pdf$/);
});

test("an empty or whitespace-only name falls back to the supplied default", () => {
  assert.equal(
    contentDispositionAttachment("   ", "file-123"),
    `attachment; filename="file-123"; filename*=UTF-8''file-123`
  );
  assert.equal(
    contentDispositionAttachment("", "file-123"),
    `attachment; filename="file-123"; filename*=UTF-8''file-123`
  );
});

test("the files route uses the helper (no raw interpolation left)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../../src/app/api/files/[id]/content/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(src, /contentDispositionAttachment\(filename, id\)/);
  assert.doesNotMatch(src, /attachment; filename="\$\{/);
});
