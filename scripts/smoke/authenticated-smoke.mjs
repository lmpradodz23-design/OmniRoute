#!/usr/bin/env node
/**
 * Authenticated smoke harness for the OmniRoute gateway (mission final gate).
 *
 * Verifies the public gateway contract against a RUNNING instance:
 *   1. GET  /v1/models            (auth)   -> 200 + { data: [...] }         [local, no paid call]
 *   2. GET  /v1/models            (bogus)  -> 401/403                        [negative auth]
 *   3. POST /v1/messages          (auth)   -> 200 (Anthropic-compatible)    [PAID — opt-in only]
 *   4. POST /v1/responses         (auth)   -> 200 (OpenAI Responses)        [PAID — opt-in only]
 *
 * SAFETY: steps 3–4 make a real upstream generation (a PAID provider call), so they are SKIPPED
 * unless you explicitly opt in with OMNIROUTE_SMOKE_ALLOW_PAID=1. Steps 1–2 are free (routing/auth).
 *
 * Config (env):
 *   OMNIROUTE_SMOKE_URL        base URL of the running gateway (default http://127.0.0.1:20128)
 *   OMNIROUTE_SMOKE_KEY        an OmniRoute API key (Bearer) — required for the auth steps
 *   OMNIROUTE_SMOKE_ALLOW_PAID set to 1/true to run the paid /v1/messages and /v1/responses calls
 *   OMNIROUTE_SMOKE_MODEL      model id for the paid calls (default: the first model from /v1/models)
 *
 * Usage:
 *   OMNIROUTE_SMOKE_URL=https://omniroute.dz23.online OMNIROUTE_SMOKE_KEY=sk-... \
 *     node scripts/smoke/authenticated-smoke.mjs
 *
 * Exit code: 0 when every NON-skipped check passed; 1 otherwise. No credential is ever printed.
 */

const BASE = (process.env.OMNIROUTE_SMOKE_URL || "http://127.0.0.1:20128").replace(/\/+$/, "");
const KEY = process.env.OMNIROUTE_SMOKE_KEY || "";
const ALLOW_PAID = /^(1|true|yes|on)$/i.test(process.env.OMNIROUTE_SMOKE_ALLOW_PAID || "");
const TIMEOUT_MS = Number(process.env.OMNIROUTE_SMOKE_TIMEOUT_MS || 20000);

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag = status === "PASS" ? "✓ PASS" : status === "SKIP" ? "• SKIP" : "✗ FAIL";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(method, pathname, { auth = true, body = undefined, key = KEY } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && key) headers.Authorization = `Bearer ${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`OmniRoute authenticated smoke — target: ${BASE}`);
  console.log(`  key: ${KEY ? "provided" : "MISSING"} · paid steps: ${ALLOW_PAID ? "ON" : "off (opt-in)"}\n`);

  // Reachability probe first — a clear message beats a stack trace.
  try {
    await req("GET", "/v1/models", { auth: false });
  } catch (err) {
    record("reachability", "FAIL", `cannot reach ${BASE} (${err?.message || err})`);
    return summarize();
  }

  // 1. GET /v1/models (auth) — free, exercises routing + key acceptance.
  if (!KEY) {
    record("GET /v1/models (auth)", "SKIP", "set OMNIROUTE_SMOKE_KEY to run");
  } else {
    try {
      const r = await req("GET", "/v1/models");
      const ok = r.status === 200 && r.json && Array.isArray(r.json.data);
      record(
        "GET /v1/models (auth)",
        ok ? "PASS" : "FAIL",
        ok ? `${r.json.data.length} models` : `status ${r.status}`
      );
    } catch (err) {
      record("GET /v1/models (auth)", "FAIL", err?.message || String(err));
    }
  }

  // 2. Negative auth — a bogus bearer must be rejected.
  try {
    const r = await req("GET", "/v1/models", { key: "sk-omniroute-smoke-invalid-key-000000" });
    const ok = r.status === 401 || r.status === 403;
    record("GET /v1/models (bogus key)", ok ? "PASS" : "FAIL", `status ${r.status} (want 401/403)`);
  } catch (err) {
    record("GET /v1/models (bogus key)", "FAIL", err?.message || String(err));
  }

  // Resolve a model id for the paid calls.
  let model = process.env.OMNIROUTE_SMOKE_MODEL || "";
  if (!model && KEY) {
    try {
      const r = await req("GET", "/v1/models");
      model = r.json?.data?.[0]?.id || "";
    } catch {
      /* handled below */
    }
  }

  // 3. POST /v1/messages (Anthropic-compatible) — PAID, opt-in.
  if (!ALLOW_PAID) {
    record("POST /v1/messages", "SKIP", "paid upstream — set OMNIROUTE_SMOKE_ALLOW_PAID=1");
  } else if (!KEY || !model) {
    record("POST /v1/messages", "SKIP", "needs OMNIROUTE_SMOKE_KEY and a model");
  } else {
    try {
      const r = await req("POST", "/v1/messages", {
        body: {
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        },
      });
      record("POST /v1/messages", r.status === 200 ? "PASS" : "FAIL", `status ${r.status}`);
    } catch (err) {
      record("POST /v1/messages", "FAIL", err?.message || String(err));
    }
  }

  // 4. POST /v1/responses (OpenAI Responses) — PAID, opt-in.
  if (!ALLOW_PAID) {
    record("POST /v1/responses", "SKIP", "paid upstream — set OMNIROUTE_SMOKE_ALLOW_PAID=1");
  } else if (!KEY || !model) {
    record("POST /v1/responses", "SKIP", "needs OMNIROUTE_SMOKE_KEY and a model");
  } else {
    try {
      const r = await req("POST", "/v1/responses", { body: { model, input: "ping" } });
      record("POST /v1/responses", r.status === 200 ? "PASS" : "FAIL", `status ${r.status}`);
    } catch (err) {
      record("POST /v1/responses", "FAIL", err?.message || String(err));
    }
  }

  return summarize();
}

function summarize() {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  console.log(`\nSummary: ${pass} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke harness crashed:", err);
  process.exit(1);
});
