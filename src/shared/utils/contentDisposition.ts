/**
 * Build a safe `Content-Disposition: attachment` header value (P-6 of the readiness audit).
 *
 * The stored filename is user-controlled. Interpolating it raw lets `"` close the quoted
 * string and `\r\n` inject further headers (response splitting) — and non-ASCII names are
 * not valid in the quoted form at all. This follows RFC 6266 / RFC 5987: an ASCII-only
 * quoted fallback (quotes, backslashes, control characters and non-ASCII replaced) plus the
 * `filename*=UTF-8''…` extended form carrying the real name percent-encoded.
 */
export function contentDispositionAttachment(filename: string, fallback = "download"): string {
  const raw = String(filename ?? "")
    // control characters (incl. CR/LF) can never be part of a header value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const ascii = raw
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  const quoted = ascii || fallback;
  const extended = encodeURIComponent(raw || fallback)
    // RFC 5987 attr-char allows these unescaped; encodeURIComponent already escapes the rest
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${quoted}"; filename*=UTF-8''${extended}`;
}
