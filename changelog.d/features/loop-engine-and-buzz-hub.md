- **feat(agentic):** Loop Engine (report-only cycle orchestration with budget, deterministic
  policy gate and human approvals — no external effect runs without approval) and Buzz Bridge
  (human+agent collaboration over a self-hosted Nostr relay, with NIP-42 auth and idempotent
  outbox/inbox). Both additive and behind feature flags (`LOOP_ENGINE_ENABLED`, `BUZZ_HUB_ENABLED`),
  configured from the single OmniRoute panel; state persisted by migration `175`. A Nostr key never
  authorizes an action in OmniRoute.
