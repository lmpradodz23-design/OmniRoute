// Host classification shared by the outbound URL guard and the provider registry.
//
// #11122: `open-sse/config/providerRegistry.ts` needs `isPrivateHost`, and that module is
// reachable from `ProviderDetailPageClient.tsx`. `outboundUrlGuard.ts` reached for `node:net`'s
// `isIP`, so importing it from the registry broke the browser bundle with
// `Could not resolve "node:net"` (caught by tests/unit/media-page-client-browser-bundle.test.ts,
// which has been red on the release branch since #11122 merged).
// The classification therefore lives here, on a pure-JS `ipVersion`, with NO platform imports.
//
// Two constraints this module MUST keep — both enforced by tests:
//   1. No `node:*` import: it is bundled for the browser.
//   2. No `@/`-aliased import: `./outboundUrlGuard.ts` re-exports from here and is loaded by the
//      packaged CLI (`omniroute setup-opencode`), where no tsconfig resolves the alias (#7682).

// Vendored from Node's own `lib/internal/net.js` so `ipVersion` stays verdict-for-verdict
// identical to `isIP` — a NARROWER match would silently reclassify a private address as public
// and open the very egress the guard exists to close. `tests/unit/private-host-ip-parity-11122`
// asserts that parity against `node:net` directly.
const V4_SEG = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const V4_STR = `(?:${V4_SEG}\\.){3}${V4_SEG}`;
const V6_SEG = "(?:[0-9a-fA-F]{1,4})";

const IPV4_RE = new RegExp(`^${V4_STR}$`);

const IPV6_RE = new RegExp(
  "^(?:" +
    `(?:${V6_SEG}:){7}(?:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){6}(?:${V4_STR}|:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){5}(?::${V4_STR}|(?::${V6_SEG}){1,2}|:)|` +
    `(?:${V6_SEG}:){4}(?:(?::${V6_SEG}){0,1}:${V4_STR}|(?::${V6_SEG}){1,3}|:)|` +
    `(?:${V6_SEG}:){3}(?:(?::${V6_SEG}){0,2}:${V4_STR}|(?::${V6_SEG}){1,4}|:)|` +
    `(?:${V6_SEG}:){2}(?:(?::${V6_SEG}){0,3}:${V4_STR}|(?::${V6_SEG}){1,5}|:)|` +
    `(?:${V6_SEG}:){1}(?:(?::${V6_SEG}){0,4}:${V4_STR}|(?::${V6_SEG}){1,6}|:)|` +
    `(?::(?:(?::${V6_SEG}){0,5}:${V4_STR}|(?::${V6_SEG}){1,7}|:))` +
    ")(?:%[0-9a-zA-Z-.:]{1,64})?$"
);

// Longest legal literal is 45 chars (`ffff:…:255.255.255.255`) plus a `%zone`. Every quantifier
// above is bounded, and this guard keeps the alternation from ever seeing a long hostile string
// (AGENTS.md → "Regex Security (ReDoS)").
const MAX_IP_LITERAL_LENGTH = 110;

// Non-canonical IPv4 spellings — bare decimal (`2130706433`), hex (`0x7f000001`), octal
// (`0177.0.0.1`) and short dotted forms (`127.1`) — are how an attacker smuggles a loopback or
// private address past a string guard. `ipVersion` (= node:net.isIP) rightly rejects them, but
// the guard used to fall through to "public" for anything that was not a canonical literal.
// URL-based callers never see these (WHATWG normalizes them to `127.0.0.1`); a raw-config caller
// must fail closed. Every quantifier is bounded (AGENTS.md → "Regex Security (ReDoS)").
const NON_CANONICAL_IPV4_RE = /^(?:0x[0-9a-f]{1,8}|\d{1,10})(?:\.(?:0x[0-9a-f]{1,8}|\d{1,10})){0,3}$/;

/** Pure-JS `node:net#isIP`: 4, 6, or 0 when the string is not an IP literal. */
export function ipVersion(host: string): 0 | 4 | 6 {
  if (!host || host.length > MAX_IP_LITERAL_LENGTH) return 0;
  if (IPV4_RE.test(host)) return 4;
  return IPV6_RE.test(host) ? 6 : 0;
}

export function normalizeHost(hostname: string) {
  let normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  // Drop the FQDN root dot. `localhost.` resolves exactly like `localhost`, and a trailing dot
  // otherwise slips past every exact and suffix test in `isPrivateHost` — including `.internal`,
  // so `metadata.google.internal.` would have been allowed (S-2). A lone "." is left alone.
  if (normalized.length > 1 && normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function isPrivateHost(hostname: string) {
  const normalized = normalizeHost(hostname);
  if (!normalized) return true;

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    // Everything in ::/96 — the unspecified address (`::`, the IPv6 twin of `0.0.0.0`), the
    // loopback `::1`, IPv4-mapped (`::ffff:7f00:1`) AND the deprecated IPv4-compatible form
    // (`::7f00:1`, i.e. `::127.0.0.1`). None is a legitimate public egress target, and the old
    // `::ffff:`-only check let the compatible form through (S-2).
    normalized.startsWith("::") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    // `.internal` is reserved for private use (ICANN-style) and is the
    // hostname suffix used by GCP/Azure metadata probes
    // (e.g. `metadata.google.internal`).
    normalized.endsWith(".internal")
  ) {
    return true;
  }

  // A numeric spelling that is NOT a canonical dotted quad is never a public host — fail closed
  // instead of falling through to "public" (see NON_CANONICAL_IPV4_RE).
  if (NON_CANONICAL_IPV4_RE.test(normalized) && ipVersion(normalized) !== 4) {
    return true;
  }

  if (ipVersion(normalized) === 4) {
    const octets = normalized.split(".").map((segment) => parseInt(segment, 10));
    const [a, b] = octets;

    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (ipVersion(normalized) === 6) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      // Link-local is fe80::/10 — fe80 through febf — not only the `fe80:` spelling, so
      // `feb0::1` used to be classified public (S-2).
      /^fe[89ab]/.test(normalized)
    );
  }

  return false;
}
