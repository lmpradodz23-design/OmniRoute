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

// ── Regressões da auditoria adversarial (2026-09-12) ──────────────────────────
// As duas primeiras reproduzem furos que passavam no handler HTTP real e desmentiam
// a frase do painel: "Page-originated external effects are denied".

test("browser-guard: clique originado na página -> deny (era allow: click não contava como efeito)", () => {
  const v = decideBrowserAction(
    { kind: "click", url: "https://example.com/confirm-purchase", origin: "page" },
    ON
  );
  assert.equal(v.decision, "deny");
  assert.match(v.reason, /originada na página/);
});

test("browser-guard: digitação originada na página -> deny", () => {
  const v = decideBrowserAction(
    { kind: "type", url: "https://example.com/form", origin: "page" },
    ON
  );
  assert.equal(v.decision, "deny");
});

test("browser-guard: leitura originada na página segue permitida (a página pode pedir mais leitura)", () => {
  const v = decideBrowserAction(
    { kind: "read", url: "https://example.com/next", origin: "page" },
    ON
  );
  assert.equal(v.decision, "allow");
});

test("browser-guard: ação de rede SEM url -> deny (era allow: a allowlist inteira era pulada)", () => {
  for (const kind of ["click", "navigate", "download", "submit"] as const) {
    const v = decideBrowserAction({ kind, origin: "user" }, ON);
    assert.equal(v.decision, "deny", `${kind} sem url deveria ser negado`);
    assert.match(v.reason, /exige url/);
  }
});

test("browser-guard: allowlist vazia nega tudo, inclusive sem url", () => {
  const EMPTY = { enabled: true, allowedDomains: [] as string[] };
  assert.equal(decideBrowserAction({ kind: "click", origin: "user" }, EMPTY).decision, "deny");
  assert.equal(
    decideBrowserAction({ kind: "read", url: "https://example.com", origin: "user" }, EMPTY)
      .decision,
    "deny"
  );
});
