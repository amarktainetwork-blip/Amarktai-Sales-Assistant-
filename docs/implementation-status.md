# Amarktai Network Sales Assistant — Honest Implementation Status

**Last audited:** 18 August 2026

This document distinguishes **built** code and user-facing workflows from **configuration-dependent** capabilities that require a customer's authorised accounts, credentials, selectors, or Webdock VPS. It does not treat an install-time setting or a UI card as proof that an external action has run successfully.

## Current capability status

| Product area | Status | What is present now | Production dependency or limitation |
| --- | --- | --- | --- |
| Sales Assistant public product | **Built** | Dark Amarktai Network landing page with prominent Sales Assistant branding, automation explanation, multi-CRM capability statement, 15-agent capability grid, review-first explanation, white-model hero, and required ownership copy. | No production dependency for the static public experience. |
| Secure workspace | **Built, configuration-dependent access** | Local Webdock login, signed session, role field, email second factor, protected dashboard and sidebar routes. | SMTP values and a live Webdock deployment are needed to complete the real second-factor journey. |
| Company setup | **Built** | A protected Company Setup route captures company name, website, industry, size, market, sales motion, and approved brand guidance in a user-owned profile. | Each workspace user currently owns one organisation profile. Multi-organisation tenancy is not implemented. |
| Website discovery and knowledge confirmation | **Built** | Public HTML discovery rejects local/private targets, limits fetched text, and returns a transient in-session preview. After explicit selection, the public URL is rechecked and only selected knowledge is written with an audit record. | The first release analyses the saved public website URL only; it is not a whole-domain crawler, document parser, or source-versioning system. |
| Review-first automation playbooks | **Built** | Users can persist organisation-specific playbook definitions with agent assignment, required capabilities, draft/active/paused state, and an enforced review-required flag. Active playbooks can prepare capability-mapped review proposals from factual context. | A playbook may only use mapped capabilities; customer templates, policy rules, and connector readiness still determine whether an approved action can execute. |
| Governed workflows | **Built, extensible library** | First contact, Call 2, Call 3, Call 4/final attempt, callback requested, booking confirmation, reschedule requested, no-show follow-up, information request, manager escalation, Cyber final close, Cyber post-consultation, and active company playbooks prepare reviewable actions, preserve idempotency keys, and record audit history. | Customer-specific sequences must be configured as active review-first playbooks with approved templates and policy. The assistant does not infer a workflow where the policy is unclear. |
| Agent catalogue and operating policy | **Built, model-dependent intelligence** | Fifteen specialist roles include the Human Communications Agent and Manager Assurance Agent. Each model-backed agent has a role-specific policy, output contract, prompt budget, model override, and safety boundary. | Model-backed responses require the configured intelligence endpoint. Agents do not invent customer facts or bypass review controls. |
| Human Communications | **Built, model-dependent** | Company profile and brand-voice context inform concise email drafts. The draft gate checks recipient, subject, factual basis, robotic wording, punctuation, and template boundary; drafts are retained for review and are not sent. | Sending still needs the Outlook connection, a valid recipient, approved template where required, and a human approval. |
| Manager Assurance | **Built** | The manager queue identifies blocked proposals, missing CRM execution evidence, stale reviews, overdue callbacks, failed or blocked workflows, incorrectly completed workflows, and ageing call reviews. Findings can be acknowledged or resolved without altering external records. | It analyses retained workspace evidence; a live CRM audit depends on calibrated CRM read scripts and saved evidence. |
| CRM Workboard and context reuse | **Built, configuration-dependent CRM read** | The Sales Operations Hub consolidates a candidate’s short-lived CRM context, callbacks, proposals, workflows, and calls. A fresh context snapshot is reused for twenty minutes to avoid repeated browser research. | Live CRM refresh needs calibrated, authorised Genie read scripts. Manual context remains visibly labelled as manual verified context. |
| Token and model efficiency | **Built, model-dependent telemetry** | Deterministic routing, compacted messages and knowledge, policy-versioned response reuse, company-context-aware request hashing, and per-agent usage records reduce repetitive model work. | Provider token counts are recorded only when returned by the configured model endpoint; character counts remain visible otherwise. |
| Multi-CRM capability registry | **Built** | User-owned CRM registrations support CRM workspace bridge, HubSpot, Salesforce, Pipedrive, and custom browser CRM labels, a capability matrix, and a deterministic router. Workflow proposals receive a capability route at creation and are blocked before review when no ready compatible connection exists. | The registry and router are not a claim that every external CRM has a pre-authenticated live connector. A connector requires authorised credentials or browser scripts and production testing. |
| CRM browser bridge | **Configuration-dependent** | Browserless/Playwright bridge, saved-script registry, action guards, screenshot evidence, and a CRM workspace bridge execution route exist without a CRM API key. | A real authorised account, URLs, selectors, and scripts must be calibrated and tested on Webdock before external CRM actions can run. |
| Email and calendar | **Partial** | Microsoft readiness checks and validated email-preview inputs exist. | A production mail-send or calendar-write flow needs Microsoft tenant credentials, permissions, a sender mailbox, and an authorised end-to-end test. |
| Live call support | **Built, model-dependent** | Manual live-call sessions retain factual transcripts/notes, coaching guidance, and summaries. | No telephony, audio capture, streaming transcription, or recording ingestion is installed. |
| Operational dashboard and audit | **Built, bounded scope** | Live counters, review queue, callback workload, calls, workflow activity, connection readiness, agent activity, audit visibility, and the Sales Operations Hub use persisted data. | Full manager analytics, revenue/funnel reporting, exportable reports, and advanced team dashboards are outside the current data model. |
| Webdock package | **Packaged, not live-validated** | Docker Compose, application image, Caddy, MariaDB, Redis, Browserless, environment template, installer, health worker, and installation guide are included. | The full stack must be deployed and tested on the user's authorised Webdock VPS. Docker is not available in this development environment. |

## Automation boundary

> **The Sales Assistant may prepare, route, and explain work. A human approves every external action before the system attempts it.**

The multi-CRM layer evaluates the required capability—such as contacts, tasks, opportunities, notes, activities, email, or calendar—against ready registrations. It attaches the resulting route to each proposal and sets an unroutable proposal to **blocked** before it can be approved. Credentials remain deployment secrets; they are never stored in the organisation or CRM-registry tables.

## Required Webdock completion steps

| Step | Why it is required |
| --- | --- |
| Configure database, local-admin, SMTP, intelligence-service, CRM browser, and Outlook secrets during installation | These values are environment-specific and intentionally excluded from source control. |
| Calibrate authorised CRM selectors and saved scripts | Browser automation cannot safely guess CRM page structure or execute against an unauthorised session. |
| Register CRM capability profiles in Company Setup | The deterministic router needs a declared, verified capability boundary before it can prepare a route. |
| Test real email, CRM, and browser workflows on the VPS | A readiness check proves configuration presence, not a completed external operation. |
| Confirm company website discovery results | Only information explicitly selected by a workspace member becomes assistant knowledge. |

## Verification completed in this repository

The additive organisation, discovery, CRM registry, automation-playbook, communication-draft, manager-finding, CRM-context, agent-usage, and response-cache migrations were reviewed and applied. Unit coverage includes website-discovery private-network rejection, bounded HTML extraction, multi-CRM capability routing, human-email quality gates, agent prompt compaction, context-cache isolation, CRM context reuse, manager assurance, workflow expansion, and active-playbook mapping. The project unit suite, TypeScript check, and production build pass locally. Live Webdock, mailbox, CRM, browser-session, and external-provider validation remain customer-environment activities.
