# Amarktai Sales Assistant

**Amarktai Sales Assistant** is a self-hosted, review-first sales-operations application for organisations that need a governed workspace for sales context, approved knowledge, workflow preparation, proposals, callbacks, call notes, CRM readiness, and evidence-backed audit history.

> **External-action rule:** The assistant may prepare, route, and explain work. It may not send an email, update a CRM, schedule a calendar item, or take another external action until a human approves the proposal and a current, server-verified route permits that exact action.

The generic product contains no default customer identity, phone number, templates, sales stages, or customer-specific workflow. The retained Course2Career material is an **inactive optional preset** for future deliberate migration/configuration; it is not imported by the generic runtime.

## What this release contains

| Area | Included now | Requires authorised production configuration |
| --- | --- | --- |
| Public experience and protected workspace | Local repository-owned visuals, local email/password sign-in, signed sessions, SMTP six-digit second factor, dashboard, company setup, audit/evidence, and review queues. | Real SMTP transport and a deliberate end-to-end login test. |
| Security and discovery | Same-origin state-change enforcement, sensitive-route rate limits, scoped secure cookies, bounded request bodies, Caddy headers, and SSRF-safe public website discovery. | Public TLS/header verification on the Webdock domain. |
| CRM | Capability registry, server-only Genie verification state, fresh-expiry routing, proposal guards, Browserless/Playwright bridge, saved-script/evidence framework. | Authorised Genie login, selector/script calibration, read-only proof, then deliberate approved write tests. |
| Intelligence | Company-aware GenX adapter with model/connection verification. | GenX endpoint, key, selected model, and live minimal-request verification. |
| Scheduler | MariaDB-backed daily schedules, authenticated internal worker, atomic claim/retry behavior, SMTP reports, and manual operator command. | Real SMTP delivery and schedule execution on the VPS. |
| Outlook | Configuration/readiness surface and sender validation. | Outlook mail/calendar execution is not implemented or claimed live. |

Read [`docs/implementation-status.md`](docs/implementation-status.md) for the built, locally verified, configuration-required, and intentionally unimplemented boundaries. Read [`docs/PRODUCTION_ACCEPTANCE.md`](docs/PRODUCTION_ACCEPTANCE.md) for the full release checklist.

## Local development and release gates

```bash
pnpm install --frozen-lockfile
pnpm dev

# Before committing
pnpm test
pnpm check
pnpm build
```

The release includes the following explicit operator commands:

```bash
pnpm reports:run          # Run due daily reports once; uses current database/SMTP settings.
pnpm verify:integrations  # Probe SMTP and configured GenX/Genie/Outlook state.
pnpm smtp:test-2fa        # Send one explicit test 2FA-format email to LOCAL_ADMIN_EMAIL.
```

## Webdock installation

Production runs with Caddy, the application, an internal worker, MariaDB 11.7, and internal Browserless Chromium. It has no production dependency on Manus/Forge storage, preview domains, hosted scheduling, owner notifications, runtime plugins, analytics placeholders, or a Genie API key.

```bash
sudo mkdir -p /opt/amarktai-sales-assistant
sudo chown "$USER":"$USER" /opt/amarktai-sales-assistant
git clone https://github.com/amarktainetwork-blip/Amarktai-Network-V2.git /opt/amarktai-sales-assistant
cd /opt/amarktai-sales-assistant
cp deploy/webdock/configuration.template .env
chmod 600 .env
nano .env
chmod +x deploy/webdock/*.sh scripts/*.sh
./deploy/webdock/install.sh
```

The installer validates required local-auth and SMTP settings, placeholder values, tests/builds, Compose configuration, database health, migrations, app liveness, and the reusable verifier. Secrets belong only in the VPS `.env`; never commit or share them.

For DNS, TLS, local administrator recovery, SMTP test messaging, Genie calibration, backups, upgrades, rollback, and truthful external-integration commissioning, follow [`docs/webdock-vps-install.md`](docs/webdock-vps-install.md).
