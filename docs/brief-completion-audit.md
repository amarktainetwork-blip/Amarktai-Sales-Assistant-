# Sales Assistant Brief Completion Audit

**Audit date:** 18 August 2026  
**Purpose:** Compare the current repository with the Course2Career operating brief and identify the remaining work needed to approach review-first coverage of most sales-administration tasks.

## Assessment principle

The platform is intentionally **review-first**. It may collect evidence, prepare a sequence, draft a communication, and route a proposed action. A person must still approve an external CRM, email, SMS, WhatsApp, or calendar change. “99% automation” therefore means the assistant prepares and validates nearly all routine administrative work; it does **not** mean that it independently changes customer records or contacts people.

## Current coverage

| Brief area | Current state | Completion assessment |
| --- | --- | --- |
| Secure workspace, local login, second factor, audit trail | Built; live validation still needs Webdock SMTP configuration. | Foundation complete; commissioning required. |
| Company knowledge and programme context | Structured company profile, guarded single-page public-site preview, explicit knowledge confirmation, and approved knowledge sources are built. | Useful foundation; course catalogue, source versioning, document extraction, citations, and full-site ingestion remain. |
| CRM safety model | Saved browser scripts, capability routing, proposal idempotency, historical-record protections, and evidence capture are built. | Requires live Genie selectors and authorised account calibration. |
| Core Course2Career workflows | First contact, Cyber final close, and Cyber post-consultation workflows are deterministic and review-first. | Call 2–4, booking, reschedule, consent, nurture, no-show, invalid-contact, escalation, and many company-specific rules remain to be codified. |
| Communications | Template-bound action proposals and Outlook readiness are built. | Human-style drafting, reply-thread context, real Outlook send/calendar operations, delivery outcomes, and channel adapters remain. |
| Agent system | Fourteen specialist role definitions, deterministic routing, and a GenX adapter exist. | Roles are not yet trained as distinct operating policies, model profiles, context budgets, or quality-evaluated workflows. |
| Manager assurance | Operational audit and review queue are built. | No manager agent, exception findings, quality queue, team performance, or completion verification workboard yet. |
| CRM-native working experience | CRM routes, browser scripts, and connection readiness exist. | No searchable CRM workboard, reusable contact context snapshot, record timeline, or record-linked assistant thread yet. |
| Dashboard and analytics | Live operational workload, readiness, execution, audit, calls, callbacks, and review metrics exist. | Full agent, manager, and administrator dashboards; funnel, conversion, team, cost, model usage, exports, and report filters remain. |
| Live calls | Manual transcript / factual-note coaching and summary are built. | Real-time audio ingestion, streaming transcription, live objection detection, call panels, and telephony integration remain. |
| Token efficiency | Deterministic workflow generation and an approved-knowledge lookup exist. | No agent-specific prompt budgets, response cache, reusable context snapshots, token/usage ledger, model routing, or cost guardrails yet. |

## Missing operating-model capabilities to build next

| Priority | Capability | Reason |
| --- | --- | --- |
| 1 | Agent policy registry and model-routing profiles | Converts named agents into consistent, testable specialist behaviours rather than using a generic prompt for every model request. |
| 1 | Human Communications Agent and pre-send quality gate | Produces concise, natural, company-aware drafts while checking facts, subject, tone, privacy, template constraints, and approval status. |
| 1 | Manager Assurance Agent and exception queue | Checks that prepared and executed work has evidence, no blocked prerequisites, no overdue callback, and no policy exception. |
| 1 | CRM workboard and reusable record context | Lets an agent pull a candidate context once, reuse it across preparation, coaching, communications, and QA, and keep the dashboard close to the CRM workflow. |
| 2 | Controlled workflow-library expansion | Adds explicit workflows for the remaining approved sales sequences, without making any generic action silently executable. |
| 2 | Context and token controls | Stores a compact, approved context summary, suppresses duplicate work, limits prompt size, routes deterministic work away from the model, and exposes usage. |
| 2 | Manager and administrator reporting | Adds quality findings, stalled/overdue work, failed communications, workflow completion, model usage, and connection health. |
| 3 | Real-time call pipeline | Requires a telephony/audio source, streaming transcription provider, and a separate low-latency integration. |
| 3 | Additional CRM and channel connectors | Requires authorisation and implementation/testing per vendor; a registry alone cannot substitute for a live connector. |

## Genie CRM commissioning boundary

The current design can connect to Genie without a Genie API key through the installed Browserless/Playwright bridge. To operate against live records it still needs the authorised Genie login, live URL, selector map for each saved script, and a non-destructive script-by-script test. Until that is complete, the platform should correctly show actions as configured, blocked, or review-required—not claim that it has changed Genie.

## Definition of a credible 99% automation target

The target is achievable only after the organisation has approved each routine workflow, supplied its CRM configuration and templates, and accepted the manager review rules. At that point the assistant can autonomously **collect context, detect eligibility, create the full action plan, draft communications, detect duplicates, validate policy, create an evidence bundle, and present one approval decision**. The user then approves or rejects; the browser bridge performs the authorised action and records the result.

> The system should automate preparation and verification at scale, while preserving deliberate human approval for every external action.
