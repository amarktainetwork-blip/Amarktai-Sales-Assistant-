# Amarktai Sales Assistant

Amarktai Sales Assistant is a self-hosted, multi-tenant sales operating layer for Webdock. It combines approved company knowledge, CRM context, conversation history and a confirmed next action so each sales workflow has one grounded source of truth. External writes remain review-controlled, idempotent and auditable.

## Source-of-truth rules

- This repository is the only source for application code, migrations, deployment automation and operator documentation. Do not maintain parallel release folders or copy production code out of Git.
- `main` is deployable only at an exact SHA whose CI and Connection-Scoped Browser Sessions workflow are green. Production runs that SHA from `/opt/amarktai-sales` with `deploy/webdock/docker-compose.yml`.
- Approved organisation knowledge is the business-context source; normalized CRM records are customer/pipeline truth; conversation history records what happened; a confirmed next action records what should happen next.
- `connectedSystems` and backend capability verification are connection truth. A configured environment variable, an OAuth redirect or a customer confirmation alone is never proof that a provider is live.
- Generated drafts and recommendations are proposals. Only accepted, correlation-bound actions may execute, and their evidence remains in the audit trail.

## Learn once, execute many

- Commissioning may use GenX to understand an unfamiliar CRM and produce a declarative operation. A browser operation becomes production-executable only after its saved version is `LIVE_PROVEN` with deterministic proof.
- Normal CRM reads, writes, readback, synchronization, Refresh Now, mailbox transport and approved-template materialization run inside a fail-closed zero-model boundary. They never fall back to GenX; a failure is surfaced as a connector/runtime failure.
- Previously learned operations are stored per organisation and connected system, then reloaded after process or browser restarts. A changed operation is degraded independently and may enter the explicit targeted-repair flow; unrelated proven operations remain usable.
- The connection-scoped CRM worker reconciles incrementally every 120 seconds by default. Operators may set `CRM_SYNC_INTERVAL_MS` (minimum 30000) without changing code. External IDs, cursors and database uniqueness constraints provide restart-safe duplicate protection.
- Genie remains authoritative. Amarktai stores synchronized projections, checkpoints, evidence and proposed actions; it does not create a second independent CRM truth.
- Every real GenX provider call is recorded in the existing AI-credit ledger with tenant/user scope, feature, bounded purpose, model, provider usage, credits and correlation reference. Credential-bound Course2Career/Outlook gates remain `AWAITING_LIVE_PROOF` until the production acceptance verifier records real evidence.

### CRM commissioning and provider packs

The browser connector resolves CRM structure in one order: the versioned code-owned provider pack, the installed connector configuration, and finally the tenant-specific learned overlay. The Genie pack contains only stable navigation and field structure; customer values and credentials never belong in it. Discovery input is allowlisted, size-bounded structural metadata, and a successful discovery fingerprint is retained so an unchanged connection is not billed again.

Missing functions are learned in one bounded initial batch rather than one model call per operation. Model output can create only a `TEST_READY` candidate. Exact-target deterministic reads and safe structural proof are required before a read operation can become `LIVE_PROVEN`. Write operations are commissioned separately against an explicitly authorised test record and require deterministic write readback before becoming `LIVE_PROVEN`. Production never falls back to an older proven version while a newer version is unproven or degraded. Routine execution and verification record `modelUsed=false` and `providerCallCount=0`.

The operation watchdog runs daily by default. An unchanged proven surface uses no GenX. Drift degrades only affected functions and permits at most one targeted repair batch for that affected set; unaffected operations remain available. Pack version, tenant-overlay version, fingerprints, affected operation keys and repair-call counts are retained in connection health evidence.

### Ordered sales work and automation governance

`salesWorkItems` is the normalized queue between CRM/mailbox truth and the Today experience. The first contact sync establishes a persisted baseline and creates no historical `NEW_LEAD` work; only an explicit creation event or a newly observed contact after that baseline may create one stable item. CRM sync also derives organisation-scoped work keys for due or overdue tasks, callbacks and opportunities needing attention. Inbound delegated-mailbox messages add reply or appointment work without copying message bodies into queue metadata. Unique source keys make repeated sync idempotent, and deterministic ordering puts overdue and higher-priority work first while retaining source freshness and last-sync evidence.

Managers choose **Assist only**, **Balanced** or **Automated** during final onboarding and may then customize the same policy in Management Controls. One deterministic server evaluator applies monitored events, scope, triggers, conditions, schedule/time zone, per-action approval mode, action caps, deduplication windows, bounded retries, quiet hours and explicit action/channel/template allowlists before trigger, work/proposal creation, approval routing and execution. Communications, opportunity/stage changes and disabled action categories retain their mandatory review boundaries; no preset silently enables destructive work.

Today work moves durably through `OPEN`, `IN_PROGRESS`, `SNOOZED`, `BLOCKED` and `COMPLETED` with an optimistic state version and transition idempotency key. Starting work opens its CRM context; snoozing and rescheduling change when it is actionable. A CRM task, inbound reply or callback closes only from its exact authoritative CRM/mailbox readback, explicit handled confirmation or recorded call outcome, after which the next deterministic queue item becomes current.

Governed actions move through explicit durable states: `PROPOSED`, `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `EDITED`, `EXECUTING`, `VERIFIED`, `FAILED` or `NEEDS_ATTENTION`. Execution uses an atomic claim and idempotency key. A CRM write resolves and proves the exact target, checks policy, executes only a commissioned deterministic operation, reads the authoritative CRM back and becomes verified only after its expected postcondition is proven. An uncertain external result becomes `NEEDS_ATTENTION` and is not blindly retried.

### Mailbox, calls and next actions

Delegated Microsoft mailbox/calendar sync and approved send/readback stay in the zero-model transport boundary and use provider message identities for duplicate protection. Inbound classification may create governed reply or appointment work. Call preparation assembles existing customer and work context; recorded outcomes create proposed note, task or follow-up actions that pass through the same approval policy and CRM readback boundary before the queue advances. Actual calls remain human-led unless an explicitly commissioned and authorised dialler action exists.

## Supported connections

Native OAuth adapters are included for **HubSpot, Salesforce, Pipedrive and Zoho CRM**. **Genie** and other authorised web CRMs use the deterministic browser connector. The **Other CRM** path is designed for a company CRM that has a usable web interface but no dedicated Amarktai API adapter; selectors and operations must be calibrated and verified before the connection can become ready.

The current guided sales onboarding includes a personal mailbox connection before CRM commissioning. Microsoft 365 is the first adapter and uses per-user delegated OAuth: every user connects and consents to their own account. There is no deployment-level shared sender or application-permission mailbox path. Reviewed email and calendar actions keep the same approval, ownership and evidence boundary. SMTP is reserved for platform mail: login second factor, password recovery, invitations and reports.

No CRM, mailbox, calendar, SMS, WhatsApp or speech provider is represented as live merely because environment variables exist. Backend verification/capability results are the readiness source of truth.

## Canonical client onboarding

A new managed workspace follows one persistent, user-visible sequence:

1. **Business** — choose individual/team mode and enter the essential company details.
2. **Learn** — read the authorised public website, show factual page progress, review the evidence-backed company knowledge and explicitly confirm it.
3. **Outlook** — connect the salesperson's existing Microsoft mailbox using delegated OAuth. Connecting a mailbox does not send customer communications.
4. **CRM** — connect the existing CRM. Browser-based CRMs such as Genie open in the Secure CRM Browser so the user enters credentials, SSO and MFA directly with the provider.
5. **Ready** — visibly commission safe CRM reads, run the initial normalized sync, confirm the signed-in salesperson's exact CRM identity, choose the automation preference and only then enter Today.

Initial onboarding is deliberately **read-only for CRM commissioning**. It must not require a production CRM mutation just to let a new user finish setup. Contact/task/note/opportunity writes are commissioned later against an explicitly authorised test record, with deterministic readback, before those exact write operations may become `LIVE_PROVEN`.

Personal Today, Customers and Assistant context are scoped to the signed-in user's confirmed CRM salesperson mapping, including when that user also has a manager/owner role. Team-wide visibility belongs on explicit management/team surfaces rather than leaking into the salesperson's personal workspace.

## Product areas

- Secure local registration/login, signed sessions, email second factor and organisation switching.
- Guided company onboarding with safe public-website discovery and explicit knowledge approval.
- Per-user delegated Outlook connection before CRM commissioning in the guided setup flow.
- Connected-system onboarding, encrypted connection credentials, OAuth, deterministic browser connectors, authorised-domain restrictions, visible commissioning health and synchronisation.
- HubSpot, Salesforce, Pipedrive, Zoho, Genie and Other CRM execution through normalized adapter contracts.
- Review/approve/skip queues with atomic action claims, idempotency protection and retained evidence/audit history.
- GenX-backed conversational sales assistance grounded in confirmed company knowledge and synchronized CRM evidence, while deterministic execution remains outside the model boundary.
- Today workspace, pipeline/team intelligence, targets, management reporting and protected exports.
- Live Call Companion with explicit microphone/consent flow and optional OpenAI-compatible STT.
- Approved email/SMS/WhatsApp proposals, delegated personal mailbox/calendar support and CRM logging.
- AI-credit accounting with concurrency-safe debits and monthly allowance grants.
- Self-hosted Webdock package with Caddy, MariaDB, Valkey and internal Chromium/CDP.

## Canonical repository

```text
https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git
```

Deploy only a `main` SHA that has passed the repository production gates.

## Fast Webdock installation

Use Ubuntu 24.04 with a non-root sudo user, Docker Engine and the Docker Compose plugin. Point the chosen domain to the VPS before public TLS acceptance.

```bash
sudo mkdir -p /opt/amarktai-sales
sudo chown "$USER":"$USER" /opt/amarktai-sales
git clone https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git /opt/amarktai-sales
cd /opt/amarktai-sales
git checkout main
git pull --ff-only origin main
```

For the easiest full self-hosted setup, run:

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/quick-install.sh
```

The guided installer:

- auto-generates strong database, JWT, application and connection-encryption secrets;
- asks only for the domain, administrator, GenX and SMTP values required for the core product;
- writes `.env` with mode `0600`;
- runs production preflight;
- builds and starts the full Webdock stack;
- applies versioned migrations through the compiled production migration runner;
- waits for the stack to become healthy;
- runs the internal smoke test automatically;
- prints the exact public production-verifier command for the chosen domain.

Optional HubSpot/Salesforce/Pipedrive/Zoho, delegated Microsoft mailbox, STT, SMS and WhatsApp configuration can be added after the core installation without rebuilding the product. The guided sales onboarding requires a configured personal mailbox adapter before that mailbox step can complete.

For delegated Microsoft mailbox/calendar support, register `${APP_PUBLIC_URL}/api/mailbox/microsoft/callback` and configure all four values together: `OUTLOOK_DELEGATED_TENANT_ID`, `OUTLOOK_DELEGATED_CLIENT_ID`, `OUTLOOK_DELEGATED_CLIENT_SECRET` and `OUTLOOK_DELEGATED_REDIRECT_URI`. Each user must then connect their own account in Amarktai; configuration alone is not consent or readiness. Provider expansion belongs behind the same personal-mailbox contract (tracked in Issue #89), not in another shared authentication or sender system.

For a smaller pilot using an authorised external Playwright-compatible CDP endpoint:

```bash
AMARKTAI_DEPLOY_PROFILE=pilot sh deploy/webdock/quick-install.sh
```

### Manual install path

Experienced operators may instead copy and fill the configuration directly:

```bash
cp deploy/webdock/configuration.template .env
chmod 600 .env
nano .env
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/install.sh
```

The standard installer now waits for the application to become internally ready and runs `deploy/webdock/smoke-test.sh` before returning success.

Do not commit `.env` or paste client secrets into tickets/chat.

## Production acceptance

After DNS/TLS is active, run:

```bash
VERIFY_PUBLIC_URL="https://YOUR_DOMAIN" \
AMARKTAI_DEPLOY_PROFILE=full \
sh deploy/webdock/verify-production.sh
```

`verify-production.sh` proves the platform/runtime and may finish with `PLATFORM_READY=PASS` and `CLIENT_ACCEPTANCE=PENDING`. After client-specific Genie and business commissioning, run the unchanged strict 34-feature matrix separately:

```bash
VERIFY_PUBLIC_URL="https://YOUR_DOMAIN" \
AMARKTAI_DEPLOY_PROFILE=full \
sh deploy/webdock/verify-client-acceptance.sh
```

A client handover requires the customer to authenticate directly in the Secure CRM Browser and, after live commissioning, `CLIENT_ACCEPTANCE=PASS`. A platform-ready deployment is not a claim that client acceptance is complete.

Company learning runs as a governed organisation background job or explicit manager action. Discovered material is source-linked and remains unapproved until a manager confirms it; the system must never silently replace approved knowledge. Secure CRM Browser state is scoped to organisation, connection and user. Customers enter passwords, SSO and MFA only on the provider page; Amarktai does not collect those credentials.

To probe fresh public-website discovery without storing or approving knowledge, run the operator-only diagnostic inside the deployed app image:

```bash
docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --no-deps --rm \
  app node dist/verifyCompanyDiscovery.js https://PUBLIC_COMPANY_WEBSITE
```

The probe reports only fetch status, page/render counts and process stability. It does not write company knowledge, alter CRM data or interact with Genie.

To run the separate full company-learning proof without persisting or approving knowledge, supply an existing billing user and organisation explicitly:

```bash
mkdir -p company-learning-output
docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --no-deps --rm \
  -v "$PWD/company-learning-output:/output" \
  app node dist/verifyCompanyKnowledge.js https://PUBLIC_COMPANY_WEBSITE USER_ID ORGANISATION_ID /output/company-learning-review.json
```

This operator-only verifier builds the canonical whole-site corpus, uses bounded inline partial-analysis and compact audit-patch batches (GenX `file_ids` are disabled as unsafe), canonicalizes harmless response-shape variation, and then validates material facts against retained sources. It prints separate analysis, audit, normalization and repair counts and writes the exact source-linked review pack to the requested local path. The global repair cap remains three and is reserved for genuinely invalid semantic output. The run may consume configured Amarktai AI credits, but it does not persist or approve knowledge, touch CRM data, or interact with Genie.

## Backup and recovery

Create a backup before updates/schema changes:

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/backup.sh
```

The backup includes a compressed MariaDB dump plus the connector calibration/evidence trees, each with checksums and a manifest. `.env`, raw deployment secrets and the connection-secret master key are intentionally excluded. Keep encrypted copies off the VPS and protect the master key separately.

Restore only with an explicit destructive confirmation:

```bash
AMARKTAI_CONFIRM_RESTORE=YES \
AMARKTAI_DEPLOY_PROFILE=full \
sh deploy/webdock/restore.sh \
  deploy/webdock/backups/amarktai-YYYYMMDDTHHMMSSZ.sql.gz \
  deploy/webdock/backups/amarktai-YYYYMMDDTHHMMSSZ-connector-files.tar.gz
```

To roll back application code after a failed release, use the **pre-update database backup**, check out the previously verified application SHA, rebuild the selected Compose profile, restore that matching backup, then run `smoke-test.sh` and `verify-production.sh`. Do not attempt schema downgrades against a newer database without restoring its matching pre-update backup.

## Development/release gates

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm check
DATABASE_URL=mysql://migration:placeholder@127.0.0.1:3306/amarktai pnpm exec drizzle-kit check
pnpm build
pnpm audit --prod --audit-level=high
```

CI additionally validates migration-generation cleanliness, all deployment shell scripts, full/pilot Compose definitions, production Docker builds/runtime contents, removal of hosted preview/runtime dependencies and Git diff sanity.

Before every deployment, record the current production SHA, create and checksum a backup, fast-forward to the exact green `main` SHA, rebuild with the same Compose profile, migrate, smoke-test and run the production verifier. Roll back only with the prior verified SHA and its matching pre-update database backup.

The post-handover roadmap is intentionally additive: more personal-mailbox adapters behind the delegated user-owned contract, more CRM presets behind the existing connection truth model, and richer governed sales workflows. It must not introduce parallel authentication, shared customer mailboxes, duplicate dashboards or another deployment source.

See [`docs/webdock-vps-install.md`](docs/webdock-vps-install.md) for operator details and [`docs/implementation-status.md`](docs/implementation-status.md) for the evidence boundary between repository-complete and live-provider commissioned behavior.
