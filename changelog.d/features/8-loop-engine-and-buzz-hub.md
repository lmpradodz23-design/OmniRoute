- **feat(agentic):** Loop Engine — report-only cycle orchestration persisted alongside the rest
  of OmniRoute (migration `175`). A run proposes steps; a deterministic Policy Gate (no model in
  the decision path) classifies each proposed effect, and an effect it does not allow parks the
  run in `awaiting_approval` until a human approves or rejects it — a `purchase`,
  `account_change` or `delete` effect is refused even then. Every run carries token, wall-clock
  and attempt ceilings and aborts instead of exceeding them, and each write is guarded by the
  run's `sequenceNumber`, so a stale writer gets a conflict instead of overwriting. Behind the
  `LOOP_ENGINE_ENABLED` flag, which is off by default: with it off the routes answer 404
  ([#8](https://github.com/LMPrado-DZ23/OmniRoute/pull/8)).
- **feat(agentic):** Buzz Hub — a durable outbox/inbox bridge that lets the Loop hand work to a
  human (or another agent) over a Nostr relay. Opt-in: no relay ships configured, the operator
  supplies one through `BUZZ_RELAY_URL` or the panel, and nothing connects until a flush runs
  with the `BUZZ_HUB_ENABLED` flag on (off by default). The agent's Nostr identity is encrypted
  at rest and only its public key ever leaves the server. A failed publish is retried with
  exponential backoff and, once the retry ceiling is reached, marked `dead` rather than retried
  forever; a relay that cannot be reached answers 502 with a generic body so the relay host is
  not disclosed ([#8](https://github.com/LMPrado-DZ23/OmniRoute/pull/8)).
- **feat(api):** management endpoints for both, documented in `docs/openapi.yaml`:
  `GET/POST /api/loop`, `GET /api/loop/{id}`, `POST /api/loop/{id}/advance`,
  `POST /api/loop/{id}/approve`, `GET/PUT /api/buzz` and `POST /api/buzz/flush`. All require
  management authentication, and on the access-token path every mutation requires `admin` scope.
  Request bodies are schema-validated and reject unknown keys, out-of-range budgets and
  oversized identifiers with a 400 that names the offending fields; a relay URL carrying
  credentials, a query string or a fragment, pointing at a private or cloud-metadata host, or
  using plain `ws://` outside loopback, is rejected with a stable error code
  ([#8](https://github.com/LMPrado-DZ23/OmniRoute/pull/8)).
- **feat(panel):** the single OmniRoute panel gains two cards under Agentic Features —
  `/dashboard/loop` (list and start report-only runs, advance one step, approve or reject a step
  awaiting a human) and `/dashboard/buzz` (flag and relay status, agent public key, outbox/inbox
  counts, "publish pending", and the relay URL settable from the panel, which takes precedence
  over the environment value) ([#8](https://github.com/LMPrado-DZ23/OmniRoute/pull/8)).
