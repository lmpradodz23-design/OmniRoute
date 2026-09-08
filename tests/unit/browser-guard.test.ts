import assert from "node:assert/strict";
import test from "node:test";

import { decideBrowserAction } from "@omniroute/open-sse/browser-guard/index.ts";

const ON = { enabled: true, allowedDomains: ["example.com"] };

test("browser-guard: desligado por padrão -> deny", () => {
  const v = decideBrowserAction(
    { kind: "navigate", url: "https://example.com", origin: "user" },
    { enabled: false, allowedDomains: ["example.com"] }
  );
  assert.equal(v.decision, "deny");
});

test("browser-guard: domínio fora da allowlist -> deny", () => {
  const v = decideBrowserAction({ kind: "navigate", url: "https://evil.com", origin: "user" }, ON);
  assert.equal(v.decision, "deny");
});

test("browser-guard: subdomínio de domínio permitido -> allow (leitura)", () => {
  const v = decideBrowserAction(
    { kind: "read", url: "https://docs.example.com/page", origin: "user" },
    ON
  );
  assert.equal(v.decision, "allow");
});

test("browser-guard: efeito externo (submit) do usuário -> require_approval", () => {
  const v = decideBrowserAction(
    { kind: "submit", url: "https://example.com/form", origin: "user" },
    ON
  );
  assert.equal(v.decision, "require_approval");
});

test("browser-guard: efeito externo ORIGINADO NA PÁGINA -> deny (prompt injection não escala)", () => {
  const v = decideBrowserAction(
    { kind: "purchase", url: "https://example.com/buy", origin: "page" },
    ON
  );
  assert.equal(v.decision, "deny");
  assert.match(v.reason, /injection|página/i);
});

test("browser-guard: URL inválida -> deny", () => {
  const v = decideBrowserAction({ kind: "navigate", url: "notaurl", origin: "user" }, ON);
  assert.equal(v.decision, "deny");
});
