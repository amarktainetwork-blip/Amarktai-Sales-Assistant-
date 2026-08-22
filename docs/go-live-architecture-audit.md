# Go-Live Architecture Audit — 22 August 2026

This release branch begins at `20522bc1be5b90edc79892ed5ad2c192e769ea1f` in `amarktainetwork-blip/Amarktai-Sales-Assistant-`. The previous non-trailing-hyphen release was preserved separately before this branch was created and is not an input to the trailing-hyphen repository runtime.

## Confirmed Advanced Foundations

The repository already contains organisation, membership, connected-system, encrypted-secret, authorised-domain, external-owner mapping, normalized CRM, sidecar-session, sales-target, team-intelligence, AI-credit, full/pilot Webdock, Valkey, internal Chromium, worker, reporter, and CI foundations. These capabilities must be consolidated rather than rebuilt or removed.

## Consolidation Boundaries

The audit found two competing runtime models. The newer model uses `organisations`, `organisationMembers`, `connectedSystems`, encrypted `connectionSecrets`, `connectorVerificationRuns`, and normalized CRM tables. It enforces organisation membership in connected-system operations and holds backend-only readiness transitions.

The legacy model remains user-owned in `companyProfiles`, `websiteDiscoveries`, `crmConnections`, `automationPlaybooks`, `workflowRuns`, `actionProposals`, `callbackTasks`, `callSessions`, `knowledgeSources`, `auditEntries`, and `dailyReports`. `server/routers.ts` still exposes `companySetup.*`, legacy `crmConnections` registration with a client-settable ready status, user-scoped workflow routing, and managed heartbeat report scheduling. The current organisation resolver also uses `ensureDefaultOrganisation()` and returns the first active membership, which is unsafe for users belonging to more than one organisation.

## Priority Implementation Order

1. Remove production Manus/Forge/OAuth/storage/runtime paths and restore a clean standalone Vite/server startup.
2. Introduce an explicit active-organisation request context, switch API contracts to it, and remove first-membership inference from sensitive paths.
3. Migrate legacy user-owned data to organisation ownership and retire `crmConnections` routing in favour of `connectedSystems`.
4. Replace the old five-step Company Setup UI/API with connected-system authentication, backend verification, sync, mapping, policy, target, credit, and go-live readiness steps.
5. Enforce transactional action execution and credit debiting, expand tenant/security/adversarial tests, then run full Webdock and CI release gates.

## Baseline Limitations

No external provider credential, live CRM tenant, Microsoft 365 tenant, SMTP account, GenX key, STT endpoint, DNS record, or Webdock VPS installation has been used during this audit. Any provider live status must remain configuration-dependent until an authorised server-side proof is recorded.

## Baseline Gate Results

The repository baseline completed its currently committed automated suite with **37 passing tests in 14 files**, and its production bundle completed successfully. The baseline build still includes a production Vite configuration with `vite-plugin-manus-runtime`, `@builder.io/vite-plugin-jsx-loc`, a Manus debug collector, Manus host allow-list entries, managed OAuth branching, and a storage proxy. Those are confirmed remediation targets, not acceptable Webdock production dependencies.

The bootstrap currently registers managed OAuth whenever local-auth mode is disabled and always registers the storage proxy. The main router still exposes legacy `companySetup.*` operations, user-owned CRM registration with a client-supplied status, user-owned playbook persistence, and a managed heartbeat scheduling call. Its newer connected-system procedures already validate membership and perform backend adapter verification. The consolidation must move client APIs to the latter model and delete or retire the former rather than run both indefinitely.

The local-auth primitive already uses bcrypt password verification and signed JWT sessions. The daily-report endpoint is still protected by a hosted cron SDK identity and surfaces raw delivery exceptions. The self-hosted worker/reporter path must become the sole scheduler trigger, with an internal token and safe error responses.
