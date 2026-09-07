- **feat(agentic):** Loop Engine (report-only cycle orchestration with budget, deterministic
  policy gate and human approvals — no external effect runs without approval) and Buzz Bridge
  (human+agent collaboration over a self-hosted Nostr relay, with NIP-42 auth and idempotent
  outbox/inbox). Both additive and behind feature flags (`LOOP_ENGINE_ENABLED`, `BUZZ_HUB_ENABLED`),
  configured from the single OmniRoute panel; state persisted by migration `175`. A Nostr key never
  authorizes an action in OmniRoute.
- **feat(panel):** operable cards in the single panel (Agentic Features): `/dashboard/loop`
  (list/start report-only cycles, advance one step, approve/reject steps awaiting human approval)
  and `/dashboard/buzz` (relay status, agent public key, outbox/inbox counts, "flush pending", and
  the relay URL now settable from the panel — precedence panel → env → default). New management
  endpoints `GET/PUT /api/buzz` and `POST /api/buzz/flush`, gated and additive.
