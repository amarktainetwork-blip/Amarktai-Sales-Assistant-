# Self-hosted security and readiness findings

The app-level security middleware permits `microphone=(self)` for the organisation-controlled live-call/STT feature, but the Webdock Caddy configuration currently overrides this with `microphone=()`. The edge configuration must allow microphone access only for the served application origin while continuing to deny camera, geolocation, and payment permissions.

Both full and pilot compose profiles still use `/api/health` for container health. The self-hosted server now exposes `/readyz` for application readiness, so profile health probes should target that endpoint where an upstream dependency check is intended.

Valkey is part of both deployment profiles, but the current application rate limiter uses an in-memory map. Sensitive endpoints need a shared Valkey-backed limiter with a fail-closed policy for security-critical operations, while non-critical presentation traffic may remain locally bounded during an optional cache outage.
