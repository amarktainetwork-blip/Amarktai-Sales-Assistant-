# Active organisation session contract

Local session JWTs now carry a numeric `activeOrganisationId` chosen only by server-side membership verification. A first login provisions a private workspace only when the user has no active membership; a user with multiple memberships receives a signed session with no active organisation and must select one through the server-verified `organisation.switch` procedure.

The request context resolves the signed membership before protected tRPC procedures execute. `organisation.available`, `organisation.current`, and `organisation.switch` provide the canonical selection flow. Tenant-sensitive REST helpers will use the same signed identity rather than re-running first-membership inference.
