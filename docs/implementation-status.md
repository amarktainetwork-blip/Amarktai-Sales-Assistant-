# Amarktai Sales Assistant — implementation status

Updated: 19 August 2026

This document distinguishes **implemented code**, **independently validated repository checks**, and **external activation that still requires authorised credentials/accounts**. A healthy container is not evidence that an external CRM or speech provider was successfully authorised.

## Current product shape

Amarktai is a desktop-first sales operating layer built on the existing React/Vite + Express/tRPC + Drizzle/MariaDB stack. The launch architecture supports deep Genie browser automation, current HubSpot OAuth/API integration, multi-person organisations, normalized CRM data, Team Intelligence, live call transcription/coaching, review-first CRM actions, and Webdock pilot/full deployment profiles.

The application remains a modular monolith plus isolated workers. It has not been rewritten around the pilot VPS.

## Independently validated repository gate

The deployment branch reached a full green GitHub Actions gate during this completion pass, including locked `pnpm` install, unit tests, TypeScript, Drizzle schema/migration validation, and the production build. After any later commit, use the PR's latest CI result as the source of truth before merging/deploying.

## Organisation and multiple salespeople

Implemented:

- organisations and organisation memberships;
- roles: owner, manager, salesperson, auditor;
- management-only access controls;
- secure team administration page;
- email invitations for local/Webdock auth;
- signed 48-hour password-setup link;
- setup link becomes unusable after the account has a password;
- member activation/deactivation and role changes;
- external CRM owner/user mapping to Amarktai members;
- normalized activity can therefore be attributed without re-syncing the CRM once per salesperson.

Not yet implemented: enterprise SCIM/SAML provisioning, many-to-many named team hierarchy, and formal per-person revenue quota/target objects.

## Genie

Implemented:

- deterministic Playwright/CDP browser connector architecture;
- generic reusable browser connector primitives;
- saved scripts with controlled navigation/fill/click/expect/read/screenshot steps;
- approved-action execution and audit/evidence boundary;
- connector capability routing;
- full Webdock profile with a repository-built internal Chromium/CDP runtime rather than a required Browserless service.

External activation still required:

- authorised Genie URL/account;
- real login and page/action selector calibration in `deploy/webdock/config/genie-scripts.json`;
- authorised read/write smoke testing;
- confirmation that the target Genie authentication/MFA/session behaviour works with the bridge.

The first pilot still accepts install-level Genie credentials. Before multi-customer commercial SaaS use, authenticated browser state must be isolated per organisation/connection rather than sharing one global account.

## HubSpot

Implemented:

- provider-neutral adapter;
- date-versioned 2026-03 OAuth token exchange/refresh/introspection/revocation flow;
- 2026-03 CRM object paths;
- encrypted connection material;
- requested scope verification;
- real read-endpoint capability tests before a requested read capability is marked available;
- contacts, companies, deals/opportunities, tasks, activities, pipeline reads and approved writes supported by the adapter;
- normalized owner IDs for team attribution.

External activation still required: real HubSpot app/client, registered callback URL, authorised portal, live OAuth/capability testing, and webhook/incremental-sync validation where used.

## Live Call Companion

Implemented:

- real browser microphone capture;
- microphone + explicitly shared browser-tab/system-audio capture mode;
- local browser mixing of call audio + microphone;
- short MediaRecorder chunks;
- authenticated/2FA protected STT bridge;
- deployment-controlled OpenAI-compatible `STT_TRANSCRIPTIONS_URL` with no direct OpenAI dependency;
- incremental transcript persistence;
- deterministic detection of common price/timing/trust objections, questions, callback requests, commitments, competitor mentions and buying signals;
- selective GenX coaching only when important semantic help is useful;
- coaching separated from transcript persistence;
- exact final transcript replacement at closeout;
- post-call GenX summary prepared for review;
- per-call explicit confirmation that organisational transcription/consent requirements have been handled;
- raw audio chunks are not retained by the current bridge.

External activation/validation still required: configured STT endpoint/model, accuracy/latency tests on the target accents/languages/headsets/dialler, direct SIP/WebRTC/provider media adapters where browser capture is unsuitable, and organisation-level retention/legal policy controls before retained audio recording is introduced.

## GenX / token economy

Implemented:

- all generative/reasoning AI stays behind GenX;
- bounded recent context and approved-knowledge budgets;
- bounded output tokens;
- optional fast/default/reasoning model tiers;
- provider usage capture when returned;
- no GenX for CRM sync, health arithmetic, Team Intelligence thresholds, management exception detection, or normal deterministic browser execution.

Not yet implemented: persistent organisation AI-credit wallet/ledger, paid checkout enforcement, and a complete customer-facing usage dashboard.

A public pricing page and centralized plan definition exist, but checkout is intentionally not presented as active billing until a verified billing provider and durable credit ledger are implemented.

## Management Intelligence

Implemented:

- Team Intelligence from synchronized CRM owners, tasks and opportunities;
- overdue-task, stale-opportunity and missing-next-step metrics;
- pipeline-at-risk amount from known opportunity values;
- management-only team administration/configuration;
- organisation-level Management Intelligence settings;
- report modes: Exceptions Only and Daily Full Brief;
- configurable overdue/stale/no-next-step thresholds;
- Webdock-owned scheduled management-email worker, not a Manus heartbeat dependency;
- Exceptions Only suppresses email when no configured exception exists;
- deterministic management emails with factual metrics;
- no webcam, keystroke, personal-browsing or unrelated-device monitoring.

Not yet implemented: formal per-salesperson quota/target pacing, closed-won revenue target forecasting, one-on-one preparation history, and richer longitudinal coaching analytics.

## Pricing

Implemented public plan source/page:

- Trial: 50 AI Credits;
- Starter: $29/month, 500 credits, one user;
- Professional: $79/month, 2,000 credits, up to three users;
- Team: $199/month, 5,000 credits, up to ten users;
- additional 1,000 AI Credits: $35;
- upstream cost assumption recorded as $10 per 1,000 upstream units;
- page explains that deterministic CRM work does not consume AI Credits.

Billing remains deliberately disabled until a payment provider and durable wallet/ledger are configured and tested.

## Webdock deployment

Implemented:

- multi-stage non-root Node image;
- Caddy TLS/reverse proxy;
- MariaDB;
- Valkey 8.1.9 using the Redis protocol;
- app, CRM-health worker and self-hosted report-scheduler worker;
- full profile with internal Chromium/CDP runtime;
- pilot profile that omits local Chromium and uses an external CDP endpoint;
- preflight validation;
- exact production port binding;
- migrations during install/update;
- application/database/cache/browser health checks;
- database backup + checksum;
- guarded update and smoke-test scripts;
- correct Genie config/evidence bind mounts;
- pinned infrastructure images where applicable.

The full profile no longer depends on a Browserless commercial licence. Pilot mode can target any authorised Playwright-compatible external CDP service.

External validation still required: run the selected profile on the actual Webdock host, confirm public DNS/TLS, SMTP delivery, and real external integration credentials.

## Website discovery and security

Implemented:

- authentication + second factor for protected operations;
- httpOnly session cookies;
- request origin checks and rate limiting;
- CSP/security headers/HSTS behind HTTPS;
- 1 MB JSON body limit;
- encrypted CRM connection secrets;
- SSRF protections for website discovery including public DNS validation and every redirect hop;
- private/link-local/local target rejection;
- connector domain allowlisting foundation;
- audit events for sensitive management/action operations.

## Open-source-first infrastructure

Default self-hosted deployment uses MariaDB, Valkey, Caddy, Chromium from Debian packages, Playwright Core and the existing open application stack. Optional/future candidates such as self-hosted faster-whisper/Speaches, whisper.cpp, LiveKit, BullMQ and OpenTelemetry remain behind replaceable boundaries. See `docs/open-source-dependencies.md`.

## What can be tested immediately after deployment

Without external CRM/STT credentials: local admin login, organisation setup, team invitation/member lifecycle once SMTP is configured, management settings, pricing, dashboard/Today/Team Intelligence with normalized test/synced data, database/cache/report-worker/app/browser health, public website discovery, and review/audit architecture.

With the respective authorised credentials: Genie deterministic browser operations after selector calibration, HubSpot OAuth/API, live call transcription/coaching, and outbound email/2FA/management reports.

## Do not call these externally verified until proven

- Genie live automation on the customer's account;
- HubSpot OAuth on a real portal;
- STT accuracy/latency on real calls;
- Webdock public deployment;
- commercial billing/credit enforcement.

Those are the remaining activation/validation gates, not hidden completed work.
