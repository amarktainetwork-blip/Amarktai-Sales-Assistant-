# Amarktai Network Sales Assistant — Honest Implementation Status

**Last audited:** 19 August 2026

This document distinguishes **built** code and user-facing workflows from **configuration-dependent** capabilities that require a customer's authorised accounts, credentials, selectors, or Webdock VPS. It does not treat an install-time setting or a UI card as proof that an external action has run successfully.

## Current capability status

| Product area | Status | What is present now | Production dependency or limitation |
| --- | --- | --- | --- |
| Sales Assistant public product | **Built** | Dark Amarktai Network landing page with prominent Sales Assistant branding, automation explanation, multi-CRM capability statement, 14-agent capability grid, review-first explanation, white-model hero, and required ownership copy. | No production dependency for the static public experience. |
| Secure workspace | **Built, configuration-dependent access** | Local Webdock login, signed session, role field, email second factor, protected dashboard and sidebar routes. | SMTP values and a live Webdock deployment are needed to complete the real second-factor journey. |
| Organisation and membership foundation | **Built, migration required** | Additive organisations, organisation members, external owner mappings, connected systems, authorised domains, and role-aware desktop navigation are implemented. Existing users lazily receive a private default organisation on first use of the new foundation. | Apply migrations `0004`–`0006` before use. Member invitation/management UX and legacy-record backfill remain follow-on implementation work. |
| Website discovery and knowledge confirmation | **Built** | Public HTML discovery rejects local/private targets, limits fetched text, and returns a transient in-session preview. After explicit selection, the public URL is rechecked and only selected knowledge is written with an audit record. | The first release analyses the saved public website URL only; it is not a whole-domain crawler, document parser, or source-versioning system. |
| Review-first automation playbooks | **Built** | Users can persist organisation-specific playbook definitions with agent assignment, required capabilities, draft/active/paused state, and an enforced review-required flag. | Playbooks are durable configuration and must be connected to additional workflow templates as those approved processes are implemented. |
| Governed workflows | **Built, limited library** | First-contact, Cyber final-close, and Cyber post-consultation workflows prepare reviewable actions, preserve idempotency keys, and record audit history. | The complete workflow library from every possible sales process cannot be safely assumed; new flows should be codified from the customer's actual approved policy and templates. |
| Agent catalogue | **Built, model-dependent intelligence** | Fourteen specialist roles cover supervision, governance, CRM context, coaching, knowledge, communications, notes, compliance, analytics, sales intelligence, objections, recommendations, CRM routing, and pipeline planning. | Model-backed responses require the configured intelligence endpoint. Agents do not invent customer facts or bypass review controls. |
| Connected Systems and CRM adapter architecture | **Built, configuration-dependent** | A provider-neutral `CrmAdapter` contract, encrypted connection-secret store, one-time OAuth state, backend-only verification state transition, normalized CRM mirror tables, sync cursors, capability evidence, and a real HubSpot OAuth/API adapter are implemented. | HubSpot requires a registered public app and authorised account. Salesforce, Pipedrive, Zoho, and bespoke adapters are represented by the contract but are not implemented live adapters in this checkpoint. |
| Browser CRM and sidecar | **Built framework, configuration-dependent operation** | The Genie saved-script runtime now uses reusable deterministic browser-script primitives with validation against executable customer-supplied content. A Manifest V3 sidecar retrieves short-lived, organisation- and domain-gated context only for an active authorised tab. | Genie and custom browser systems need a reviewed profile, authorised session, page detector/record extractor calibration, and live customer-authorised test before record-specific context or write operations can be claimed. |
| Email and calendar | **Partial** | Microsoft readiness checks and validated email-preview inputs exist. | A production mail-send or calendar-write flow needs Microsoft tenant credentials, permissions, a sender mailbox, and an authorised end-to-end test. |
| Live call support | **Built, model-dependent** | Manual live-call sessions retain factual transcripts/notes, coaching guidance, and summaries. | No telephony, audio capture, streaming transcription, or recording ingestion is installed. |
| Today, Sales Session, and Team Intelligence | **Built, data-dependent** | Desktop-first Today and Sales Session views deterministically prioritize normalized CRM work by task due date, stale opportunity age, missing next step, and opportunity value. Manager Team Intelligence deterministically groups overdue tasks, stale opportunities, no-next-step records, and at-risk pipeline by mapped CRM owner. | The views remain intentionally empty until an authorised system is verified, synchronized, and its external owners are mapped to organisation members. Targets, historical conversion, and email reporting need additional configured data and implementation. |
| Webdock package | **Packaged and hardened, not live-validated** | The package now has a multi-stage non-root application image, pinned Browserless tag, service health checks, safe app health endpoint, persistent connector-evidence storage, hardened Caddy headers, a non-root Node health worker, and environment placeholders for HubSpot and encrypted CRM secret storage. | The full stack still must be deployed and tested on the user's authorised Webdock VPS. Docker is not available in this development environment. |

## Automation boundary

> **The Sales Assistant may prepare, route, and explain work. A human approves every external action before the system attempts it.**

The multi-CRM layer evaluates the required capability—such as contacts, tasks, opportunities, notes, activities, email, or calendar—against ready registrations. It attaches the resulting route to each proposal and sets an unroutable proposal to **blocked** before it can be approved. OAuth and browser-session material is stored only in encrypted connection-secret records using a server-side AES-256-GCM master key; it is never returned through APIs, logs, audit evidence, or GenX context.

## Required Webdock completion steps

| Step | Why it is required |
| --- | --- |
| Configure database, local-admin, SMTP, intelligence-service, HubSpot OAuth, encrypted connection-secret key, CRM browser, and Outlook secrets during installation | These values are environment-specific and intentionally excluded from source control. |
| Calibrate authorised CRM selectors and saved scripts | Browser automation cannot safely guess CRM page structure or execute against an unauthorised session. |
| Register CRM capability profiles in Company Setup | The deterministic router needs a declared, verified capability boundary before it can prepare a route. |
| Test real email, CRM, and browser workflows on the VPS | A readiness check proves configuration presence, not a completed external operation. |
| Confirm company website discovery results | Only information explicitly selected by a workspace member becomes assistant knowledge. |

## Verification completed in this repository

Additive migrations `0004_universal_sales_foundation`, `0005_crm_oauth_state`, and `0006_sidecar_sessions` were generated and validated with Drizzle; they have not been applied to a customer deployment. Unit coverage includes website-discovery safeguards, CRM capability routing, encrypted connection secrets, declarative browser-script validation, and cross-organisation access policy. The project unit suite, TypeScript check, Drizzle migration check, and production build pass locally. Live Webdock, mailbox, HubSpot OAuth, CRM browser-session, selector calibration, and external-provider validation remain customer-authorised activities.
