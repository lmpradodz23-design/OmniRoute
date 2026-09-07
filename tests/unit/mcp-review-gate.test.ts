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

test("mcp-review: update SEM novas permissões, com prior aprovado -> approved (carrega)", () => {
  const prior = { version: "1.0.0", permissions: ["net:fetch", "fs:read"], approved: true };
  const v = reviewMcpCandidate(
    { name: "x", source: "reg", version: "1.0.1", permissions: ["net:fetch"] },
    prior
  );
  assert.equal(v.state, "approved");
  assert.equal(v.requiresHumanApproval, false);
});

test("mcp-review: prior NÃO aprovado -> review_required (não carrega aprovação inexistente)", () => {
  const prior = { version: "1.0.0", permissions: ["net:fetch"], approved: false };
  const v = reviewMcpCandidate(
    { name: "x", source: "reg", version: "1.0.1", permissions: ["net:fetch"] },
    prior
  );
  assert.equal(v.state, "review_required");
});
