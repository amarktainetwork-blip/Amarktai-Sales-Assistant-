# Amarktai Sales Assistant — Webdock Release Evidence

This record covers the externally pushed release candidate at `ac9af7c2465c6426233360c5cd1c1977ac6082aa`. It is a **deployment-ready package**: all repository-controlled checks passed, while secrets, provider authorization, DNS/TLS issuance, and live-service verification remain intentionally deferred to the Webdock installation environment.

REPOSITORY=amarktainetwork-blip/Amarktai-Sales-Assistant-
REMOTE=https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git
BASE_SHA=20522bc1be5b90edc79892ed5ad2c192e769ea1f
BRANCH=release/go-live-20260822
FINAL_SHA=ac9af7c2465c6426233360c5cd1c1977ac6082aa

MANUS_RUNTIME_REMOVED=Yes; executable-source audit found zero managed-runtime references.
FORGE_RUNTIME_REMOVED=Yes; executable-source audit found zero Forge runtime references.
PRODUCTION_ASSETS_LOCAL=Yes; repository-owned assets are served from the standalone client build.
COURSE2CAREER_ISOLATED_TO_OPTIONAL_PRESET=Yes; current executable-source audit found zero customer-specific runtime references.

AUTH_CANONICAL=Local signed-session authentication with active organisation binding.
PUBLIC_REGISTRATION=Implemented; public local registration creates a password-hashed user and bootstrap workspace, then follows the existing 2FA gate.
PASSWORD_RECOVERY=Implemented; generic non-enumerating reset request and signed, password-hash-bound reset tokens.
2FA=Implemented; local email second factor is enforced for protected operations when SMTP is configured.
TENANT_ISOLATION=Implemented for active new paths, including company setup, workflows, action proposals, callbacks, calls, knowledge, audits, reports, pipeline mappings, integration profiles, exports, and saved items; migrations 0007–0013 are additive and nullable-first for legacy reconciliation.
ORGANISATION_SWITCHING=Implemented; verified membership selection is embedded in the signed local session and enforced by tRPC and protected HTTP routes.

CONNECTED_SYSTEMS_SINGLE_SOURCE_OF_TRUTH=Yes; canonical active-organisation connected systems govern CRM readiness and action routing.
LEGACY_CRM_RUNTIME_REMOVED=Yes; legacy client-controlled CRM registration and action routing are retired from executable paths.

HUBSPOT_CODE=Implemented through the canonical connected-system registry and backend verification; live authorization is installation-time.
SALESFORCE_CODE=Implemented through the canonical connected-system registry and backend verification; live authorization is installation-time.
PIPEDRIVE_CODE=Implemented through the canonical connected-system registry and backend verification; live authorization is installation-time.
ZOHO_CODE=Implemented through the canonical connected-system registry and backend verification; live authorization is installation-time.
GENIE_BROWSER_CODE=Implemented through the browser bridge, saved-script registry, review-first router, and calibration runbook; live selector calibration is installation-time.
CUSTOM_BROWSER_CODE=Implemented through the canonical connected-system registry; configured browser automation must be verified on the target environment.

OUTLOOK_MAIL=Review-first Microsoft Graph mail boundary implemented; a real sender and approved review reference are required at installation.
OUTLOOK_CALENDAR=Review-first Microsoft Graph calendar boundary implemented; an approved review reference is required at installation.
SMTP=Self-hosted SMTP integration, health/readiness checks, local 2FA and password-recovery delivery paths implemented; a real mailbox must be verified at installation.
SMS=Review-first action proposals only; no customer-specific sender, template, phone number, or unverified live transport is embedded.
WHATSAPP=Review-first action proposals only; no customer-specific template or unverified live transport is embedded.

WEBSITE_DISCOVERY_SSRF=Implemented; blocks private/local destinations, rechecks discovered pages, restricts HTML, and persists only explicitly confirmed knowledge.
BROWSER_DOMAIN_ENFORCEMENT=Implemented in browser connector/session policy; target connector domains and selectors are configured at installation.
CONNECTION_SECRET_ENCRYPTION=Implemented for server-side connected-system secrets; secrets are entered only in the Webdock `.env`/installation path.

GENX=Optional self-hosted integration boundary implemented; no runtime secret is committed.
GENX_MODEL_VALIDATION=Configured-only until an authorised model endpoint is entered during installation and the verifier runs.
AI_CREDIT_LEDGER=Implemented as an organisation-scoped ledger.
AI_CREDIT_ATOMICITY=Implemented with transactional organisation locking and idempotency references.
BILLING=No customer billing integration is claimed or required for Webdock deployment.

LIVE_CALL_COMPANION=Implemented with active-organisation ownership, factual transcript handling, and review-first follow-up proposals.
STT=Optional installation-time integration; no live transcription provider is claimed without authorized target credentials.
MICROPHONE_POLICY_FIXED=Yes; Webdock Caddy policy permits microphone access only for same-origin application use while retaining other restrictive permissions.

TEAM_MANAGEMENT=Implemented with organisation roles, 2FA-protected management actions, invitation flow, CRM-owner mapping, and pipeline-stage mapping.
TEAM_INTELLIGENCE=Implemented with organisation-scoped operational data and configured pipeline-stage categories.
SALES_TARGETS=Implemented through existing organisation-scoped sales controls.
AUTOMATION_POLICY=Implemented with review-first playbooks and capability-aware controlled actions.
ACTION_IDEMPOTENCY=Implemented with atomic claims, 15-minute stale-claim recovery, and correlation-bound finalization.
PLAYBOOKS_GENERIC=Yes; generic review-first playbooks and neutral workflow keys require organisation-configured templates, senders, and pipeline mappings.
KNOWLEDGE=Implemented with active-organisation ownership and explicit confirmation before website-derived knowledge becomes available.

HEALTHZ=Implemented at `/healthz`.
READYZ=Implemented at `/readyz` with database-aware readiness.
WEBDOCK_FULL_PROFILE=Validated syntactically and by GitHub CI Compose configuration plus production image build; runtime launch is installation-time.
WEBDOCK_PILOT_PROFILE=Validated syntactically and by GitHub CI Compose configuration plus production image build; runtime launch is installation-time.
BACKUP=Self-hosted Webdock backup procedure is included in deployment documentation.
ROLLBACK=Self-hosted Webdock rollback procedure is included in deployment documentation.
PRODUCTION_VERIFIER=Included in `deploy/webdock`; it validates configuration and reports provider readiness truthfully without inventing live proof.

EXPORTS=Implemented; active-organisation-scoped CSV operational-report and PDF factual conversation-log downloads are protected by the signed session.
WORKSPACE_FAVORITES_AND_TAGS=Implemented; migration 0013 adds organisation-scoped saved items with normalized tags and action-proposal re-authorization.
API_FEEDBACK=Implemented; dashboard/review loading, error, retry, and mutation progress feedback is explicit.

TESTS=61 tests passed across 25 files locally at the final code state.
TYPECHECK=Passed locally at the final code state.
BUILD=Standalone production build passed locally at the final code state.
DRIZZLE_CHECK=Passed locally before final generic runtime cleanup; the final generic cleanup did not change the schema or migrations and GitHub CI validated Drizzle at the final SHA.
DOCKER_APP_BUILD=Passed in GitHub CI run 32579295685.
DOCKER_BROWSER_BUILD=Passed in GitHub CI run 32579295685.
COMPOSE_FULL=Passed in GitHub CI run 32579295685.
COMPOSE_PILOT=Passed in GitHub CI run 32579295685.
CI_RUN=https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-/actions/runs/32579295685
CI_STATUS=completed success for FINAL_SHA.

FORBIDDEN_MANUS_SEARCH=0 executable-source matches.
CUSTOMER_HARDCODING_SEARCH=0 executable-source matches for customer names, legacy workflow keys, or hardcoded sender data.
TODO_FIXME_MOCK_SEARCH=0 executable runtime TODO/FIXME matches; test mocks remain confined to test files.

EXTERNALLY_LIVE_PROVEN=No. No Webdock host, DNS/TLS endpoint, SMTP mailbox, CRM account, browser session, Graph tenant, or STT provider credentials were supplied or exercised. No live proof is claimed.
AWAITING_EXTERNAL_CREDENTIALS=Webdock installation-time `.env` values and authorised provider accounts only. Run the documented preflight, migrations, full or pilot Compose launch, `/healthz`, `/readyz`, SMTP 2FA/recovery delivery, connector verification, and provider-specific calibration after deployment.

FINAL_STATUS=READY_FOR_WEBDOCK_DEPLOYMENT
