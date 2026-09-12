- **feat(mcp):** MCP approvals are now stored on the server, so `POST /api/mcp/review` can reach
  `approved` again without trusting the request body. `POST /api/mcp/review/approve` (admin, behind
  `MCP_REVIEW_ENABLED`) records a human approval keyed by the candidate's `name` + `source` and
  refuses with `422 MCP_REVIEW_DENIED` anything the gate denies; `POST /api/mcp/review/revoke`
  revokes it. A later review carries the approval only when permissions are not broadened and the
  publisher is explicitly verified (migration `177`) ([#17](https://github.com/LMPrado-DZ23/OmniRoute/pull/17)).
