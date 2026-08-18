# Amarktai Network Sales Assistant — Honest Implementation Status

**Last audited:** 18 August 2026

This document is intentionally strict. A feature is only described as **built** when it exists in the current code and has a usable interface or backend contract. A feature is **configuration-dependent** when the code exists but requires production credentials, a live account, selector calibration, or the Webdock environment. A feature is **not yet built** when the approved brief requires it but the current repository does not provide the data model, service, or end-to-end interface.

## Current reality

| Product area | Status | What is actually present | What is not yet complete |
| --- | --- | --- | --- |
| Public landing and sign-in | **Built, being redesigned** | Responsive landing page, access page, navigation, application routes, local sign-in form, and an email second-factor gate. | The public, login, and workspace visual systems still need to be fully unified under the darker Amarktai Network direction. |
| Workspace shell | **Built, partial dashboard** | Protected sidebar, command-centre route, workflow studio, agent desk, call desk, knowledge hub, connections page, and review queue. | This is **not** yet the full consultant, manager, and administrator dashboard specified in the brief. |
| Dashboard metrics | **Built, limited** | Counts for review-required proposals, open callbacks, executed/blocked actions, call sessions, recent workflow runs, and audit entries. | No today/overdue task queue, team performance, funnel, conversion, pipeline, bookings, course, revenue, cost, or model-usage dashboards. |
| Governed workflows | **Built, limited** | Rule-based first-contact, Cyber final-close, and Cyber post-consultation proposal preparation with review and audit records. | The full library of operational workflows, templates, office-hour rules, escalation, and exception management remains incomplete. |
| Approval and audit trail | **Built** | Proposal approval/skip actions, guarded browser execution pathway, persisted execution result, evidence status, and proposal-specific audit entries. | Live evidence is only meaningful after a calibrated CRM script runs successfully in the Webdock environment. |
| CRM browser bridge | **Configuration-dependent** | Browserless/Playwright bridge, saved-script registry, action guards, health check, persistent evidence path, and Webdock Compose service definitions. | A real authorised CRM login, live URLs, selectors, and each script must be calibrated and tested. No live CRM action has been validated here. |
| Email and calendar | **Partial** | Readiness checks and validated email-preview inputs. | There is no confirmed end-to-end production mail-send or calendar-write workflow until Microsoft Graph credentials, permissions, and a real mailbox are configured and tested. |
| Call coaching | **Built, configuration-dependent intelligence** | A manually started live-call session, transcript/note capture, persisted coaching notes, and summary contract. | No audio capture, streaming transcription, recording ingestion, or live telephony integration is installed. Model-backed coaching requires the configured external model provider. |
| Knowledge | **Built, limited** | Manual approved notes/URLs, readiness status, and keyword-ranked source grounding for the Knowledge Agent. | No document extraction pipeline, embeddings/vector search, source versioning, approval workflow, or citation interface. |
| Model-backed agents | **Configuration-dependent** | Agent catalogue, command routing, prompt boundaries, and a server-side model-provider adapter. | Requires a live model endpoint and credential; chat is not yet a complete conversation-history, streaming, feedback, or evaluation system. |
| Authentication | **Built, configuration-dependent** | Self-hosted administrator login path, signed session, role field, email second-factor challenges, and expiry controls. | The production local-login and SMTP second-factor flow must be run on Webdock with real configured secrets before it can be called live-validated. |
| Webdock deployment | **Packaged, not live-validated** | Docker Compose, app Dockerfile, Caddy configuration, MariaDB, Redis, Browserless, installer, environment template, scripts, and operating guide. | Docker is not available in this development environment. The full Compose startup, migrations, routing, browser worker, and health worker still require validation on the user’s Webdock VPS. |

## The dashboard gap

The current **Command Centre is an operational overview**, not the finished dashboard described in the brief. It has useful, real data-backed elements, but it does not yet satisfy the required consultant, manager, or administrator dashboard scope.

| Required dashboard outcome | Current state | Build required |
| --- | --- | --- |
| Consultant day view | Partial counters only | Today’s tasks, overdue tasks, calls, callbacks, lead statuses, meetings, opportunities, next best action, recent notes, templates, and course quick reference. |
| Manager performance view | Not built | Team task completion, consultant activity, contact/conversion/booking rates, losses, pipeline, overdue/stalled leads, compliance exceptions, duplicate warnings, failed communication and review load. |
| Administrator operations view | Partial connection readiness | Connected-system status, automation configuration, sender/office-hour settings, roles, permissions, error reports, usage and workflow logs. |
| Reporting | Not built | Lead, funnel, course, consultant, campaign, communication, audit, and performance reporting with date filters and exportable views. |

## What installation does and does not do

Installing the Webdock package supplies the **runtime environment**: database, cache, browser service, reverse proxy, application container, local administrator bootstrap, configuration loading, and scheduled health worker. It does **not** create the missing dashboard, reporting models, integrations, or CRM scripts automatically.

> Installation enables the configuration-dependent features to run. It does not convert partially implemented features into finished capabilities.

## Next build sequence

The next implementation pass is therefore focused on the product gap rather than additional visual scaffolding. It will create a real operations dashboard from the persisted workload, extend the data and server contracts for dashboard queues and trend metrics, consolidate customer-facing branding under **Amarktai Network**, remove external provider language from public screens, and unify landing, sign-in, and workspace styling.
