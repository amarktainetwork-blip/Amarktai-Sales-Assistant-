# Amarktai Sales Assistant — Final Release Validation

**Date:** 22 August 2026

**Repository:** `amarktainetwork-blip/Amarktai-Sales-Assistant-`

**Release branch:** `release/go-live-20260822`

**Validated release SHA:** `708e3e5a85d84723d97b6ce7c2be96908b2b0458`

**Reconciled main parent:** `20522bc1be5b90edc79892ed5ad2c192e769ea1f`

**Pull request:** #1 — Release/go live 20260822

**GitHub Actions CI run:** `32596497598`

**Verification job:** `97088218086`

## Repository-controlled release gates

All of the following passed on the exact reconciled release SHA:

- locked dependency installation
- unit tests
- TypeScript type checking
- Drizzle schema/migration validation
- clean migration generation
- production application build
- production dependency audit at high-severity threshold
- deployment shell syntax validation
- hosted Manus/Forge runtime regression scan
- canonical trailing-hyphen repository check in operator documentation
- full Webdock Compose validation
- pilot Webdock Compose validation
- application + internal Chromium production image builds
- production image runtime-content verification (`dist/migrate.js`, `dist/verifyIntegrations.js`, migration journal and built frontend)
- git diff sanity

The pull request was mergeable after the two-parent reconciliation commit. No force push was used.

## Deployable product shape

The release contains the self-hosted Webdock deployment, local authentication + email second factor, organisation/tenant controls, approved knowledge onboarding, AI-credit accounting, GenX-backed assistant functions, Live Call Companion/STT boundary, review-first execution, team administration/intelligence/targets, and the installed CRM adapter set for HubSpot, Salesforce, Pipedrive, Zoho CRM, Genie and Other CRM through the restricted browser connector.

Microsoft 365 / Outlook includes reviewed Graph email and reviewed calendar-event execution when the target tenant/application permissions are configured. SMTP remains mandatory for access codes, recovery, invitations and reports. SMS/WhatsApp remain configuration-dependent channel bridges unless supplied natively by a verified CRM/browser connector.

## Target-environment commissioning still required

This CI evidence proves repository/build/deployment-package readiness. It does **not** claim that third-party customer credentials have already been commissioned.

Before client handover on Webdock, complete the installation guide and verify with authorised production/sandbox accounts:

1. DNS + Caddy HTTPS/TLS.
2. MariaDB/Valkey and production migrations.
3. real SMTP transport and second-factor delivery.
4. real GenX model-catalog + minimal-inference verification.
5. the client's selected CRM OAuth/login, capability verification and initial sync.
6. one explicitly approved non-critical CRM write with audit/evidence.
7. Outlook Graph mail/calendar if the client elects to use Microsoft 365.
8. STT + microphone/browser acceptance if Live Call Companion is enabled.
9. SMS/WhatsApp live acceptance only if those channels are configured.
10. backup creation, checksum verification and a restore rehearsal in an isolated environment.

Use `deploy/webdock/verify-production.sh` after the service is public to collect final target-environment proof.

**Repository status:** `READY_FOR_WEBDOCK_DEPLOYMENT`

**External-provider status:** `AWAITING_AUTHORISED_CLIENT_COMMISSIONING`
