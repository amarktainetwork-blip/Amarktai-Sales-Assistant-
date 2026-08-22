# Amarktai Sales Assistant — Implementation Status

**Updated:** 22 August 2026

This record distinguishes **implemented repository behavior**, **verified release gates**, and **external activation that requires an authorised Webdock environment or provider account**. A passing build or healthy container is not evidence that a CRM, mailbox, browser session, STT service, or Microsoft tenant is authorised.

## Current Product Shape

Amarktai Sales Assistant is a self-hosted, multi-tenant sales operating layer built with React/Vite, Express/tRPC, Drizzle/MariaDB, Valkey, Caddy, and optional self-hosted Chromium/CDP. It prepares CRM and communications work from approved organisation context, retains a review trail, and prevents AI from silently authorising external actions.

The standalone release has no executable Manus, Forge, managed OAuth, hosted scheduler, storage-proxy, or preview-runtime dependency. Local signed sessions are the production identity boundary. The application remains a modular monolith with isolated report and health workers, rather than being optimized around a pilot VPS.

## Verified Release Gates

| Gate | Current result |
|---|---|
| Release branch | `release/go-live-20260822` in `amarktainetwork-blip/Amarktai-Sales-Assistant-` |
| Current audited SHA | `ac9af7c2465c6426233360c5cd1c1977ac6082aa` |
| GitHub Actions | CI run `32579295685` completed successfully at the current SHA. |
| Local tests | 61 tests in 25 files passed. |
| TypeScript | `pnpm check` passed. |
| Schema | `pnpm drizzle-kit check` passed. |
| Production bundle | `pnpm build` passed. |
| Webdock packaging | Shell syntax, full/pilot Compose validation, and app/browser production-image builds passed in CI. |

## Identity, Security, and Multi-Tenancy

Implemented behavior includes public local registration, non-enumerating password-recovery requests, password-hash-bound reset links, password hashing, email second factor, httpOnly signed session cookies, explicit active-organisation selection, membership switching, and manager/owner controls.

Every active new operational path is scoped to the selected organisation: company setup, discoveries, confirmed knowledge, playbooks, connected systems, workflow runs, action proposals, callback tasks, live-call records, audits, reports, pipeline mappings, integration profiles, exports, and saved items. Migrations `0007` through `0013` are additive and nullable-first where legacy reconciliation is required; no legacy row is assigned to an arbitrary organisation.

Security controls include origin checks, CSRF-aware cookie settings, request-size limits, shared Valkey-backed rate limiting with production fail-closed behavior for sensitive paths, public-auth limits, SSRF-safe website discovery, encrypted connected-system secrets, security headers, active-organisation guards, audit events, atomic AI credit debits, and atomic approved-action claims with stale-claim recovery and correlation-bound finalization.

## Sales Operations and Review-First Automation

The product provides a governed Command Centre, workflow preparation, review/skip/approve controls, CRM capability routing, execution evidence, result visibility, callbacks, daily reports, policy-driven automation, management intelligence, sales targets, human communications drafting, supervisor checks, CRM context reuse, agent/usage controls, and active pipeline-stage mappings.

The generic workflow catalogue is intentionally neutral: first contact, post-consultation follow-up, and final-close review. Organisation-specific templates, sender identities, stages, and contact data must be entered during configuration; no customer-specific phone number, exact template, or vertical-specific stage is embedded in the active runtime.

The agent catalogue covers supervisor/orchestration, workflow governance, CRM context, conversation coaching, knowledge grounding, communications, notes and summaries, QA/compliance, analytics, sales intelligence, objection handling, recommendations, multi-CRM routing, and pipeline planning. AI prepares content and recommendations only; a human review remains required before external action.

## CRM and Browser Integrations

The canonical `connectedSystems` registry is the only production readiness and action-routing source. It supports server-verified HubSpot, Salesforce, Pipedrive, Zoho, Genie/browser, custom browser, and custom API registrations. The HubSpot adapter includes encrypted material, OAuth boundaries, capability checks, normalized CRM records, pipeline reads, and approved writes. The Genie/browser architecture includes deterministic Playwright/CDP primitives, saved scripts, screenshot evidence, domain policy, and review-first execution.

No live CRM or Genie claim is made without installation-time credentials, OAuth authorisation, selector calibration, and capability verification. A browser connector is not marked ready merely because configuration exists.

## Communications, Calls, and Reporting

Local SMTP supports second-factor delivery, recovery delivery, and report delivery once a real mailbox is configured. Microsoft Graph mail and calendar requests are review-first and require an approved review reference. SMS and WhatsApp are modeled as reviewable proposals; no unverified live sender or hardcoded customer template exists.

The Live Call Companion protects call and transcript access by active organisation, stores factual transcripts, detects deterministic signals, prepares coaching and review-first follow-up proposals, and supports an optional OpenAI-compatible STT boundary. The deployment only claims live transcription after a target STT endpoint/model is configured and tested.

The Operations Dashboard can produce protected active-workspace **CSV exports** for operational reports and **PDF exports** for factual conversation logs. The server derives organisation identity from the signed session, bounds returned content, and does not accept a client-supplied organisation identifier.

## Workspace Productivity

Users can save reviewable action proposals as private active-workspace favorites, assign normalized tags, update them, and remove them. The saved-item model supports future lead and pitch references without storing provider secrets. The Command Centre and dashboard now expose explicit loading states, per-action progress labels, actionable errors, and retry controls instead of treating API failure as an empty workspace.

## Webdock Deployment

The repository ships a full profile with MariaDB, Valkey, Caddy, app, report worker, health worker, and self-hosted Chromium/CDP, plus a pilot profile that accepts an authorised external CDP endpoint. It includes an environment template, preflight, install, backup, update, rollback, smoke-test, health/readiness endpoints, and Caddy policy.

Use the correct trailing-hyphen repository, check out `release/go-live-20260822`, create an installation-only `.env` from `deploy/webdock/configuration.template`, and run the documented profile installer. The standard migration step includes `0013_magenta_fabian_cortez.sql` for workspace favorites/tags.

## Still Requires Target-Environment Proof

The following are commissioning activities, not missing source features:

| Area | Required target action |
|---|---|
| Webdock | Launch the selected profile, apply migrations, and confirm `/healthz` and `/readyz`. |
| Public access | Point DNS to Webdock and confirm Caddy TLS plus secure-cookie behavior. |
| SMTP/2FA | Configure a real mailbox and receive a login second-factor, reset link, and report email. |
| CRM | Authorise each selected provider and execute the server verification/capability checks. |
| Genie/browser | Calibrate selectors and saved scripts using an authorised account. |
| Graph/STT/GenX | Configure only chosen optional integrations and retain verifier evidence. |
| Acceptance | Under a real local user and 2FA session, test onboarding, exports, favorites/tags, review/approval, and error recovery. |

## Deliberately Out of Scope Until a Business Requirement Exists

Enterprise SAML/SCIM, formal hierarchical sales territories, native billing/checkout, live-provider-specific media adapters, and organisation-specific sales cadences are not claimed as generic default features. The AI credit ledger is implemented and concurrency-safe, but a commercial checkout provider is intentionally not enabled.

## Truthful Go-Live Position

The codebase is **ready for Webdock deployment**. The application is **not yet live-provider proven**, because no Webdock host, mailbox, DNS endpoint, CRM account, Genie session, Graph tenant, GenX endpoint, or STT provider credential was supplied for this audit.
