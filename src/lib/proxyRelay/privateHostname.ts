/**
 * Shared private/loopback host guard for the three proxy-relay workers
 * (Cloudflare, Deno Deploy, Vercel Edge).
 *
 * The three generators each carried a byte-identical copy of this policy inlined
 * as a string, so a gap had to be found and fixed three times. It is now written
 * once and embedded verbatim via `Function#toString`, the same mechanism
 * `resolveRelayTarget` already uses — the edge runtimes cannot import Node
 * helpers, so the source has to travel as text.
 *
 * Pure (only `String`/`RegExp`, no Node or Deno globals) so the SAME source runs
 * in every worker and is unit-testable directly in Node.
 *
 * Callers pass `new URL(target).hostname`, which is already WHATWG-normalized:
 * `2130706433` arrives as `127.0.0.1`, and `::ffff:127.0.0.1` arrives as
 * `[::ffff:7f00:1]`. The brackets are stripped here.
 */
export function isPrivateRelayHostname(h: string): boolean {
  if (!h) return true;
  let host = String(h)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  // Drop the FQDN root dot. `localhost.` resolves exactly like `localhost`, and
  // a trailing dot otherwise slips past every exact and suffix test below —
  // including `.internal`, so `svc.internal.` would have been allowed.
  if (host.length > 1 && host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return true;

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  // Everything in ::/96 — the unspecified address, IPv6 loopback, IPv4-mapped
  // (`::ffff:7f00:1`) and the deprecated IPv4-compatible form (`::7f00:1`).
  // None of them is a legitimate public relay target, and `http://[::]/` reaches
  // a service bound to the IPv6 loopback.
  if (host.startsWith("::")) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local IPv4
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // ULA fc00::/7
    // Link-local is fe80::/10 — fe80 through febf, not only the `fe80:` spelling.
    if (/^fe[89ab]/.test(host)) return true;
    // The `startsWith("::")` test above only sees the compressed spelling; the same
    // ::/96 and ::ffff:0:0/96 addresses written out (`0:0:0:0:0:ffff:7f00:1`,
    // `0:0:0:0:0:0:0:1`) must be blocked too (final audit B-1). Expand inline —
    // this function is embedded verbatim into edge workers and cannot import.
    let text = host;
    const lastColon = text.lastIndexOf(":");
    const tail = text.slice(lastColon + 1);
    if (tail.includes(".")) {
      const o = tail.split(".").map((s) => Number(s));
      if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
      text = `${text.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const halves = text.split("::");
    if (halves.length > 2) return true;
    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 2 ? missing < 1 : missing !== 0) return true;
    const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return true;
    const g = groups.map((x) => x.padStart(4, "0"));
    if (
      g[0] === "0000" &&
      g[1] === "0000" &&
      g[2] === "0000" &&
      g[3] === "0000" &&
      g[4] === "0000"
    ) {
      return true; // ::/80 — unspecified, loopback, IPv4-compatible, IPv4-mapped
    }
    if (
      g[0] === "0064" &&
      g[1] === "ff9b" &&
      g[2] === "0000" &&
      g[3] === "0000" &&
      g[4] === "0000" &&
      g[5] === "0000"
    ) {
      // NAT64 64:ff9b::/96 — apply the IPv4 rules to the embedded address.
      const a = parseInt(g[6].slice(0, 2), 16);
      const b = parseInt(g[6].slice(2), 16);
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      return false;
    }
    return false;
  }

  return false;
}
