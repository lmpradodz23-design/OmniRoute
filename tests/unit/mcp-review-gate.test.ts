import assert from "node:assert/strict";
import test from "node:test";

import { reviewMcpCandidate } from "@omniroute/open-sse/mcp-review/index.ts";

test("mcp-review: pacote marcado como malicioso -> denied", () => {
  const v = reviewMcpCandidate({
    name: "evil",
    source: "reg",
    version: "1.0.0",
    permissions: ["net:fetch"],
    flaggedMalicious: true,
  });
  assert.equal(v.state, "denied");
  assert.equal(v.requiresHumanApproval, false);
});

test("mcp-review: permissão proibida (exfiltração/billing) -> denied", () => {
  const v = reviewMcpCandidate({
    name: "greedy",
    source: "reg",
    version: "1.0.0",
    permissions: ["net:fetch", "secrets:exfiltrate"],
  });
  assert.equal(v.state, "denied");
});

test("mcp-review: servidor novo -> review_required (aprovação humana)", () => {
  const v = reviewMcpCandidate({
    name: "novo",
    source: "reg",
    version: "1.0.0",
    permissions: ["net:fetch"],
  });
  assert.equal(v.state, "review_required");
  assert.equal(v.requiresHumanApproval, true);
});

test("mcp-review: update que AMPLIA permissão volta a review_required (mesmo se antes aprovado)", () => {
  const prior = { version: "1.0.0", permissions: ["net:fetch"], approved: true };
  const v = reviewMcpCandidate(
    { name: "x", source: "reg", version: "1.1.0", permissions: ["net:fetch", "fs:write"] },
    prior
  );
  assert.equal(v.state, "review_required");
  assert.deepEqual(v.newlyRequested, ["fs:write"]);
});

// 2026-09-12: este caso afirmava `approved` com `publisherVerified` OMITIDO, que é o fail-open
// que a auditoria adversarial reprovou — um candidato cuja verificação de publisher nunca rodou
// carregava a aprovação anterior sozinho. Carregar uma aprovação agora exige publisher
// explicitamente verificado; a ausência conta como não verificado.
test("mcp-review: update SEM novas permissões, publisher verificado -> approved (carrega)", () => {
  const prior = { version: "1.0.0", permissions: ["net:fetch", "fs:read"], approved: true };
  const v = reviewMcpCandidate(
    {
      name: "x",
      source: "reg",
      version: "1.0.1",
      permissions: ["net:fetch"],
      publisherVerified: true,
    },
    prior
  );
  assert.equal(v.state, "approved");
  assert.equal(v.requiresHumanApproval, false);
});

test("mcp-review: publisher REPROVADO na verificação -> review_required mesmo sem ampliar", () => {
  const prior = { version: "1.0.0", permissions: ["net:fetch"], approved: true };
  const v = reviewMcpCandidate(
    {
      name: "x",
      source: "reg",
      version: "1.0.1",
      permissions: ["net:fetch"],
      publisherVerified: false,
    },
    prior
  );
  assert.equal(v.state, "review_required");
  assert.equal(v.requiresHumanApproval, true);
});

test("mcp-review: prior NÃO aprovado -> review_required (não carrega aprovação inexistente)", () => {
  const prior = { version: "1.0.0", permissions: ["net:fetch"], approved: false };
  const v = reviewMcpCandidate(
    { name: "x", source: "reg", version: "1.0.1", permissions: ["net:fetch"] },
    prior
  );
  assert.equal(v.state, "review_required");
});

// ── Regressões da auditoria adversarial (2026-09-12) ──────────────────────────

test("mcp-review: permissão proibida em CAIXA ALTA -> denied (escapava por casar string exata)", () => {
  const v = reviewMcpCandidate({
    name: "evil",
    source: "https://evil.example/pkg",
    version: "9.9.9",
    permissions: ["KEYS:READ", "Secrets:Exfiltrate"],
  });
  assert.equal(v.state, "denied");
});

test("mcp-review: permissão sensível em caixa mista ainda avisa o revisor humano", () => {
  const v = reviewMcpCandidate({
    name: "x",
    source: "reg",
    version: "1.0.0",
    permissions: ["Shell:Exec"],
  });
  assert.equal(v.state, "review_required");
  assert.ok(
    v.reasons.some((r) => /sensíveis/.test(r)),
    "o revisor precisa ver que o pacote declara permissão sensível"
  );
});

test("mcp-review: ampliação detectada mesmo com caixa diferente entre prior e candidato", () => {
  const v = reviewMcpCandidate(
    { name: "x", source: "reg", version: "2.0.0", permissions: ["FS:READ", "shell:exec"] },
    { version: "1.0.0", permissions: ["fs:read"], approved: true }
  );
  assert.equal(v.state, "review_required");
  assert.deepEqual(v.newlyRequested, ["shell:exec"]);
});

test("mcp-review: publisherVerified AUSENTE conta como não verificado (era auto-aprovado)", () => {
  const v = reviewMcpCandidate(
    { name: "x", source: "reg", version: "2.0.0", permissions: ["fs:read"] },
    { version: "1.0.0", permissions: ["fs:read"], approved: true }
  );
  assert.equal(v.state, "review_required");
  assert.equal(v.requiresHumanApproval, true);
});

test("mcp-review: publisher verificado explicitamente e sem ampliação -> approved", () => {
  const v = reviewMcpCandidate(
    {
      name: "x",
      source: "reg",
      version: "2.0.0",
      permissions: ["fs:read"],
      publisherVerified: true,
    },
    { version: "1.0.0", permissions: ["fs:read"], approved: true }
  );
  assert.equal(v.state, "approved");
});
