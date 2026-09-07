- **feat(providers):** ChatGPT Web clean-room provider (codex-chatgpt-web v4.0.7) backported
  onto the green `v3.8.50` baseline — vendored adapter, reconciled executors, `storageState`
  browser-pool sessions, and a single additive convergence migration (`174`) that reaches the
  clean-room state from both a fresh DB and an existing release DB. The provider stays inert
  until an operator supplies a ChatGPT storage-state credential; the legacy `cgpt-web` alias
  remains retired. OpenAI-compatible `/v1/responses` and Anthropic-compatible `/v1/messages`
  are served by the existing gateway routes.
