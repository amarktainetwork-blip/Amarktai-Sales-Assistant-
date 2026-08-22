# Amarktai Sales Assistant — Honest Implementation Status

**Last audited:** 22 August 2026

This document distinguishes code that is built and locally validated from capabilities that still require an authorised Webdock VPS, domain/DNS, real mailbox, GenX account, Genie browser session, or Microsoft permissions. A configuration field, browser card, or passing local mock is **not** treated as proof that an external action has run.

## Product and security status

| Product area | Status | What is implemented | Remaining operational proof or limitation |
| --- | --- | --- | --- |
| Public product and local assets | **Built and production-built locally** | The Amarktai Sales Assistant landing page, sign-in view, white-model hero, workflow/coaching/trust/auth visuals, and favicon are repository-owned files under `client/public`. | Local build verified that required assets land under `dist/public`; public Webdock/CDN/TLS delivery remains untested. |
| Generic Amarktai runtime | **Built and regression-tested** | Generic workflows, supervisor routing, knowledge wording, UI examples, and GenX prompts contain no default Course2Career/Cyber sender, stage, template, or customer identity. | The retained `server/presets/course2career.ts` is a migration reference only, is inactive by default, and has no runtime import or activation path. |
| Local authentication and 2FA | **Built and locally tested** | Local email/password authentication uses signed HTTP-only, host-only cookies with `SameSite=Lax` and production Secure cookies. Second-factor codes use SMTP. Development preview remains unavailable in production. | An authorised Webdock mailbox must receive and verify a real code before production sign-off. |
| Request and browser hardening | **Built and regression-tested** | Request body limits, restricted proxy trust, state-change same-origin enforcement, sensitive tRPC procedure rate limits, Caddy security headers, and bounded public-website discovery are present. Discovery blocks private IPv4/IPv6 ranges, credentials, custom ports, unsafe redirects, and non-HTML responses. | Reverse-proxy headers require a public Webdock/DNS/TLS verification. Rate limits are in-memory for this single-app Compose deployment. |
| Company setup and approved knowledge | **Built** | A protected organisation profile, guarded website preview, explicit confirmation, audited knowledge storage, capability registrations, and review-first playbooks are available. | The first release supports one organisation profile per workspace user and one saved public website URL; it is not a whole-domain crawler or document-ingestion platform. |
| Review-first workflow preparation | **Built and regression-tested** | Generic first-contact, follow-up, callback, booking, reschedule, no-show, information, escalation, and post-call outcomes create duplicate-protected review proposals only. | Organisation-specific templates, phone numbers, stages, and policies must be configured and approved by the organisation; no external action occurs on preparation. |
| CRM capability routing | **Built and regression-tested** | A proposal gets a required capability route. Only a fresh, server-verified Genie browser bridge route can be executable; stale, missing, failed, or unimplemented provider routes fail closed. | HubSpot, Salesforce, Pipedrive, and custom-browser registrations are truthful non-executable profiles in this release until connectors are implemented and verified. |
| Genie CRM bridge | **Packaged, configuration-dependent** | Browserless/Playwright, saved scripts, proposal ownership, evidence persistence, and server verification exist without any Genie API key. The UI shows verification state, failure, and expiry; it cannot set readiness locally. | An authorised Genie account, login URL, selectors, scripts, and deliberate read/write calibration are required. No live Genie action was run in this environment. |
| GenX intelligence service | **Built, optional integration** | The runtime uses the configured chat endpoint only when ready. The production verifier tests the derived `/v1/models` endpoint and a bounded minimal completion request. | No GenX credentials were supplied, so no live model request has been performed. Misconfigured optional GenX remains Not Ready. |
| SMTP and daily reports | **Built, mandatory transport configuration** | SMTP transport uses bounded timeouts. The worker invokes an authenticated internal daily-report route every minute, evaluates UTC schedules, claims deliveries atomically, and releases failed claims for retry. | A real SMTP transport and actual daily delivery are only verifiable on the VPS. No hosted scheduler or owner-notification service is used. |
| Outlook | **Partial, configuration-only** | Tenant/client/secret/sender readiness and email-preview validation are present. The verifier validates configured sender email format. | No Outlook send or calendar-write operation is implemented or live-tested. Do not claim Outlook automation is active. |
| Manager assurance, communications, call support, audit | **Built, model-dependent where applicable** | Human-style draft quality gates, manager findings, token/cache controls, manual text-based call coaching, review queue, evidence, audit records, and operations dashboards are persisted. | Live calls do not include telephony, audio capture, streaming transcription, or recording ingestion. Model-backed output needs a verified GenX configuration. |
| Webdock deployment package | **Packaged and statically validated** | Compose defines Caddy, app, worker, MariaDB, and Browserless; Docker image, installer, verifier, backup, upgrade, rollback, configuration template, and canonical runbook are included. | Docker/Compose is unavailable in this development environment, so Compose config, image build, migrations in a clean container, and live stack startup have not been executed here. GitHub CI is configured to gate Compose definition and image build. |

## External-action boundary

> **The assistant may prepare, route, and explain work. A human must approve every external action before an execution attempt. The attempt is blocked unless its route is current, server-verified, capability-compatible, and owned by the workspace.**

Credentials are install-time VPS secrets. They are not stored in organisation, connection, workflow, or audit records, and this repository does not contain live credentials.

## Required Webdock commissioning actions

| Commissioning step | Reason it cannot be pre-claimed locally |
| --- | --- |
| Configure domain DNS and run public TLS/header verification | Certificate issuance and Caddy network reachability require the real VPS/domain. |
| Perform local admin password plus six-digit SMTP-code sign-in | Confirms real transport, sender, inbox delivery, cookie scope, and protected workspace access. |
| Run the production verifier with actual SMTP credentials | Confirms the configured SMTP server accepts the connection within bounded timeouts. |
| Supply GenX values and run its verifier | Confirms models endpoint, selected model availability, and minimal completion against the authorised provider. |
| Register and server-verify Genie | Confirms authorised browser login and dashboard selector; a configuration card alone is insufficient. |
| Calibrate read scripts, then deliberate approved writes on non-critical CRM records | Confirms selectors, permissions, evidence capture, idempotency, and business policy safely. |
| Provide Outlook permissions and deliberately test sender/write behavior if enabled | The current release does not implement Outlook delivery or calendar writes. |

## Local validation completed in this repository

The development database migration removing the obsolete hosted-scheduler UID column was generated, reviewed, applied, and queried successfully. Focused regression suites cover generic runtime isolation, cookie/logout behavior, same-origin and rate limits, SSRF discovery boundaries, CRM fresh/stale/unimplemented routing, GenX model verification behavior, SMTP safe failure, and self-hosted scheduler due/skip/retry logic. TypeScript and the standalone production build passed locally. The built server responded to `/healthz`; `/readyz` correctly returned `503` without production configuration. No live Docker, VPS, mailbox, GenX, Genie, or Outlook action is claimed.
