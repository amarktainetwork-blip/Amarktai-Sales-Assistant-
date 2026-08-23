# Tenant context router findings

The local-login procedure is the single place that creates the signed application session. The tRPC context currently includes an authenticated user and second-factor status but no organisation membership. `organisation.current` and several execution paths still call `ensureDefaultOrganisation()`, while connected-system and sales procedures accept a client-provided organisation identifier and verify it ad hoc.

The next implementation step is to resolve the signed active membership in context after authentication, provide an explicit server-verified switch mutation that reissues the session, and progressively reject a supplied organisation identifier whenever it differs from the active organisation.
