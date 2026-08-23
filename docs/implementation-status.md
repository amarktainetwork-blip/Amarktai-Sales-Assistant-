# Amarktai Sales Assistant — Implementation Status

**Updated:** 22 August 2026

This document separates repository-complete behavior from target-environment commissioning. The exact final release SHA and gate results are recorded in `docs/final-release-validation-20260822.md` after the release branch is reconciled with `main`; do not rely on a hard-coded SHA in this status page.

## Product shape

Amarktai Sales Assistant is a self-hosted multi-tenant sales operating layer built with React/Vite, Express/tRPC, Drizzle/MariaDB, Valkey, Caddy and optional self-hosted Chromium/CDP. It prepares and executes governed sales work from confirmed organisation context while retaining human review, idempotency, execution evidence and audit history.

The production source has no executable Manus/Forge hosted-preview dependency. Local signed sessions and email second factor are the self-hosted identity boundary.

## Implemented and release-gated

- Public/local account registration, login, password recovery, signed sessions, email second factor and organisation switching.
- Organisation-scoped company setup, safe website discovery and explicitly approved knowledge.
- Command Centre, Today workspace, workflow preparation, review/approve/skip, callbacks, targets, management intelligence, exports and audit history.
- Atomic action claims and correlation-bound finalisation to prevent duplicate approved writes.
- GenX agent execution with bounded context/output, timeouts/retries, live commissioning probe and AI-credit accounting.
- Native OAuth CRM adapters for **HubSpot, Salesforce, Pipedrive and Zoho CRM**.
- **Genie** and **Other CRM** deterministic browser adapters with encrypted credentials, reviewed saved scripts, screenshot evidence and authorised-domain/private-network controls.
- CRM synchronization, normalized contacts/companies/opportunities/tasks/activities, pipeline reads and verified-capability routing.
- Review-first sales email/SMS/WhatsApp actions. CRM-native delivery is preferred where supported; generic SMTP/webhook delivery can log the completed communication back to CRM.
- Microsoft 365 / Outlook Graph support for reviewed outbound sales mail and approved calendar-event creation when the installation tenant is configured and commissioned.
- Live Call Companion with organisation isolation, explicit consent/media boundary, factual transcript storage, coaching, post-call proposals and optional OpenAI-compatible STT.
- Team administration, owner mappings, QA rubrics, compliance/retention dry-run records, connector webhook intake, observability and worker records.
- Webdock full/pilot packaging, runtime migration executable, preflight, install/update, backup, guarded restore, smoke test and production verifier.

## Connection truth

`connectedSystems` is the CRM readiness source of truth. A CRM can become `ready` only after its backend adapter tests the requested capabilities. Merely registering a CRM or completing OAuth is not proof of usable capabilities.

The user-facing connection choices intentionally expose only executable paths:

| Connection | Method |
|---|---|
| HubSpot | Native OAuth/API |
| Salesforce | Native OAuth/API |
| Pipedrive | Native OAuth/API |
| Zoho CRM | Native OAuth/API |
| Genie | Deterministic authorised browser connector |
| Other web CRM | Organisation-specific deterministic browser connector |

A company with another browser-accessible CRM can use **Other CRM** after its authorised hostname, login and reviewed operation profile are calibrated. The product does not pretend to have a native API adapter for every CRM.

## Microsoft 365 / communications

SMTP is mandatory for account second factor, password recovery, invitations and reports. Reviewed sales email uses a CRM-native sender when the verified CRM provides one; otherwise `OUTBOUND_EMAIL_PROVIDER=auto` prefers configured Outlook Graph and falls back to SMTP. Approved `create_calendar_event` proposals route through Outlook Graph and retain the same approval/correlation evidence boundary as CRM writes.

SMS/WhatsApp require either a verified CRM/browser-native channel or an explicitly configured idempotent webhook bridge. They are not called live until target acceptance succeeds.

## Security / tenancy

Active operational paths are organisation-scoped. Controls include request-size/origin protection, secure cookies, shared Valkey rate limits with fail-closed sensitive paths, SSRF-safe website discovery, encrypted connection secrets, browser-domain/private-network enforcement, Caddy security headers, atomic AI-credit debits, audit records and review-first external execution.

## Webdock deployment

The full profile runs Caddy, app, CRM health worker, reporter, MariaDB, Valkey and internal Chromium/CDP. The pilot profile uses an authorised external Playwright-compatible CDP endpoint. Production migrations run from the compiled runtime (`node dist/migrate.js`) rather than relying on pruned development tooling.

`backup.sh` protects MariaDB plus connector calibration/evidence with checksums and a manifest while deliberately excluding `.env` and raw deployment secrets. `restore.sh` requires explicit destructive confirmation and validates checksums/archive paths before replacing the application database.

## Target-environment commissioning still required

These actions cannot truthfully be proven by repository code alone:

- Webdock host, DNS and Caddy TLS.
- Real SMTP delivery and login second-factor completion.
- Real GenX model/API response.
- OAuth/credentials and capability verification for the client's chosen CRM.
- Selector/profile calibration for Genie/Other CRM.
- Microsoft Graph token/mail/calendar acceptance if Outlook is used.
- Real STT audio acceptance if Live Call Companion transcription is enabled.
- SMS/WhatsApp sender acceptance if those channels are enabled.
- One real authorised CRM read and one safe reviewed external write.
- Backup creation/checksum and recovery rehearsal according to the client's operational policy.

## Go-live boundary

The repository is **ready for Webdock deployment only after the exact release SHA passes the final release validation ledger**. Client handover is complete only after `deploy/webdock/verify-production.sh` passes on the target and the selected external integrations have their authorised acceptance evidence. Optional integrations that are not configured remain explicitly `NOT_CONFIGURED`; they do not prevent the core product from operating unless the client requires them for handover.
