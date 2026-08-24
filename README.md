# Amarktai Sales Assistant

Amarktai Sales Assistant is a self-hosted, multi-tenant sales operating layer for Webdock. It combines approved company knowledge, CRM context, review-first automation, sales/team intelligence, live-call support and audited external actions without giving AI an unreviewed path to customer systems.

## Supported connections

Native OAuth adapters are included for **HubSpot, Salesforce, Pipedrive and Zoho CRM**. **Genie** and other authorised web CRMs use the deterministic browser connector. The **Other CRM** path is designed for a company CRM that has a usable web interface but no dedicated Amarktai API adapter; selectors and operations must be calibrated and verified before the connection can become ready.

Microsoft 365 / Outlook is optional. When the approved tenant/application is configured, reviewed sales email can use Microsoft Graph and approved `create_calendar_event` actions can create Outlook calendar events. SMTP remains mandatory for login second factor, password recovery, invitations and reports.

No CRM, mailbox, calendar, SMS, WhatsApp or speech provider is represented as live merely because environment variables exist. Backend verification/capability results are the readiness source of truth.

## Product areas

- Secure local registration/login, signed sessions, email second factor and organisation switching.
- Guided company onboarding with safe public-website discovery and explicit knowledge approval.
- Connected-system onboarding, encrypted connection credentials, OAuth, deterministic browser connectors, authorised-domain restrictions, health verification and synchronisation.
- HubSpot, Salesforce, Pipedrive, Zoho, Genie and Other CRM execution through normalized adapter contracts.
- Review/approve/skip queues with atomic action claims, idempotency protection and retained evidence/audit history.
- GenX-backed specialist sales agents grounded in confirmed company knowledge.
- Today workspace, pipeline/team intelligence, targets, management reporting and protected exports.
- Live Call Companion with explicit microphone/consent flow and optional OpenAI-compatible STT.
- Approved email/SMS/WhatsApp proposals, Microsoft 365 mail/calendar support and CRM logging.
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

Optional HubSpot/Salesforce/Pipedrive/Zoho, Outlook, STT, SMS and WhatsApp credentials can be added after the core installation without rebuilding the product.

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

A client handover requires `CLIENT_ACCEPTANCE_READY=PASS` plus browser acceptance under the real authorised account. A platform-ready deployment is not a claim that client acceptance is complete.

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

See [`docs/webdock-vps-install.md`](docs/webdock-vps-install.md) for operator details and [`docs/implementation-status.md`](docs/implementation-status.md) for the evidence boundary between repository-complete and live-provider commissioned behavior.
