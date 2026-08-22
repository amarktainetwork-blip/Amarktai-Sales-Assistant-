# Complete Release Audit — Amarktai Sales Assistant

**Audit date:** 22 August 2026  
**Repository:** `amarktainetwork-blip/Amarktai-Sales-Assistant-`  
**Release branch:** `release/go-live-20260822`  
**Audited release head:** `ac9af7c2465c6426233360c5cd1c1977ac6082aa`  
**Hosted CI:** [run 32579295685](https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-/actions/runs/32579295685) — passed

> **Simple deployment answer: YES.** The repository is ready to deploy to a Webdock VPS.  
> **Simple operational answer: NO.** It cannot honestly be called live-provider proven until the Webdock host, DNS/TLS, SMTP mailbox, and any chosen CRM/browser/AI/STT providers are configured and tested with authorised credentials.

This distinction is deliberate. The source release contains no committed secrets, and external systems are not marked ready merely because their connector code exists.

## 1. What Is Complete in the Release

| Product area | Implemented functions | Audit result |
|---|---|---|
| **Standalone Webdock runtime** | React/Vite frontend; Express/tRPC backend; MariaDB; Valkey; Caddy; report worker; health worker; full self-hosted Chromium/CDP profile; pilot external-CDP profile; backup, update, rollback, smoke-test, preflight, install scripts. | **Complete in code and CI validated.** Runtime launch remains a VPS task. |
| **Authentication** | Local password sign-in, public registration, secure bcrypt hashing, email 2FA, generic non-enumerating recovery request, password-hash-bound reset links, httpOnly signed session cookies, logout. | **Complete in code.** Real email delivery awaits SMTP configuration. |
| **Organisation tenancy** | Active organisation bound to the signed session; switcher; membership/role controls; active-organisation guards in tRPC and protected HTTP routes; additive organisation migrations; cross-tenant denial tests. | **Complete for all active new paths.** Legacy rows remain nullable until target reconciliation, by design. |
| **Onboarding** | Company profile, SSRF-safe public website discovery, explicit knowledge confirmation, canonical verified CRM connection setup, generic review-first playbooks, truthful go-live review. | **Complete in code.** A real organisation must populate its own profile, policies, templates, CRM configuration, and approved knowledge. |
| **CRM foundation** | Canonical connected-system registry, capability routing, verified readiness state, encrypted connection material, HubSpot/OAuth boundaries, Salesforce/Pipedrive/Zoho/custom/browser registration paths, CRM owner mapping, pipeline-stage mappings. | **Complete as a provider boundary.** Live authorization and capability proof await the selected provider accounts. |
| **Genie/browser automation** | Deterministic browser/CDP architecture, saved-script registry, domain restriction, evidence capture, review-first approved action execution, recovery guidance. | **Complete as an automation framework.** No live Genie selector or account is claimed configured. |
| **Review-first execution** | Action proposals, manual approval/skip, policy-controlled automation, atomic action claim, 15-minute stale-claim recovery, correlation-bound finalization, audit/evidence trail. | **Complete and regression tested.** No AI route directly performs an unreviewed external action. |
| **Sales operations** | Command Centre, workflow preparation, callbacks, factual call records, approved knowledge, management intelligence, sales targets, daily reports, supervisor assurance, agent catalogue, CRM context reuse, duplicate controls, usage controls. | **Complete as a generic sales-operations baseline.** Organisation-specific sequences should be configured, not hardcoded. |
| **AI controls** | Bounded context, model roles, deterministic routing, approved knowledge grounding, AI-credit ledger with transaction locking and idempotency, human review controls. | **Complete in code.** GenX model/provider proof awaits authorised installation settings. |
| **Communications** | Human-style controlled drafts, review-first Outlook mail/calendar boundary, SMTP 2FA/recovery/report delivery paths, SMS/WhatsApp proposal modeling. | **Complete as a controlled boundary.** No live outbound sender is claimed without provider setup. |
| **Live Call Companion** | Organisation-scoped call sessions/transcripts, deterministic signal detection, coaching, review-first follow-up proposals, optional OpenAI-compatible STT boundary, consent prompt. | **Complete in code.** STT accuracy and live media workflow require target testing. |
| **Exports** | Active-workspace CSV operational-report exports and PDF factual conversation-log exports, bounded server-side source queries, formatter tests, dashboard progress/error feedback. | **Complete and tested.** |
| **Favorites and tags** | Active-workspace saved items for proposals, leads, and pitches; normalized tags; proposal re-authorisation; audit trail; Command Centre controls; additive migration `0013`. | **Complete and tested.** |
| **UX reliability** | Loading states, action progress labels, actionable mutation errors, retryable dashboard/review queue/saved-item failures, secure access gate. | **Complete for audited primary operational paths.** |
| **Security** | Shared Valkey rate limiting with production fail-closed behavior, public-auth rate limits, request-size limit, CSP/security headers, SSRF protections, encrypted connection secrets, origin checks, audit logging. | **Complete in source and tests.** Host-level TLS and network policy still need deployment validation. |

## 2. Verification Evidence

| Gate | Result | Evidence |
|---|---|---|
| TypeScript | Passed | `pnpm check` passed during this audit. |
| Regression suite | Passed | **61 tests in 25 files** passed during this audit. |
| Drizzle schema/migrations | Passed | `pnpm drizzle-kit check` passed. Migrations `0000`–`0013` are present. |
| Production bundle | Passed | `pnpm build` passed. Vite emitted a non-blocking bundle-size advisory only. |
| Deployment scripts | Passed | Shell syntax passed for preflight, install, update, backup, and smoke-test scripts. |
| Compose configuration | Passed | Full and pilot profile checks passed in GitHub CI. |
| Production images | Passed | Application and browser images built in GitHub CI. |
| Source boundaries | Passed | No executable Manus/Forge runtime references; no customer-specific active runtime names, vertical workflow keys, hardcoded senders, or phone data found. |
| Release hygiene | Passed | Current release branch uses the correct trailing-hyphen remote and current source tree was clean before documentation reconciliation. |

## 3. Go-Live Blockers and Their Meaning

There are **no identified source-code blockers to deploying the package**. The remaining items below are commissioning gates. They prevent a claim that the corresponding external service is live-proven; they do not prevent a Webdock deployment of the core application.

| Priority | Area | Why it remains open | Exact action after deployment |
|---|---|---|---|
| Required | Webdock runtime | The local sandbox has no target Docker/Webdock host. | Create installation-only `.env`, run the selected full or pilot installer, apply migrations, and confirm `/healthz` plus `/readyz`. |
| Required for public access | DNS and TLS | Caddy certificate issuance needs a real domain resolving to the VPS. | Point DNS to Webdock and validate HTTPS, secure cookies, redirects, and Caddy logs. |
| Required when local 2FA/reports are used | SMTP | A real mailbox is not available in source control. | Configure SMTP in `.env`; receive a 2FA code, recovery link, and scheduled report test. |
| Required per selected CRM | CRM authorization | OAuth/API secrets and tenants must be entered at installation. | Authorise the provider, run server verification, verify capabilities, then test only allowed read/write actions. |
| Required for Genie/browser work | Selector calibration | Browser selectors and logged-in state cannot be inferred or safely embedded. | Calibrate the saved scripts with an authorised session, domain restrictions, and human-reviewed write tests. |
| Required only if enabled | Graph, GenX, STT | These integrations are optional and intentionally unconfigured. | Enter only chosen provider settings and retain verifier evidence. |
| Recommended before operational acceptance | Authenticated acceptance pass | The preview intentionally has no production user/session/provider account. | Test organisation setup, CRM readiness, review, export, favorite tags, error retries, and reports as a real 2FA user. |

## 4. Incomplete or Deliberately Deferred Product Areas

The following are not hidden defects. They are either intentionally deferred until there is an organisation-specific requirement or are enterprise-scale additions beyond a generic Webdock launch.

| Area | Current position | Recommendation |
|---|---|---|
| Enterprise identity | Local authentication/2FA is complete; SAML, SCIM, and enterprise IdP provisioning are not included. | Add only when a customer requires enterprise SSO/provisioning. |
| Billing and payments | AI-credit ledger is implemented; paid checkout and subscription enforcement are not active. | Add Stripe only after pricing, tax, and support policy are final. |
| CRM breadth | Registry supports the named provider paths, but individual provider authorization and deep sync behavior are installation-specific. | Launch with the one or two CRMs actually required; expand adapters based on verified demand. |
| Generic workflows | Three neutral governed workflow paths are active. The agent catalogue is broader, but exact sales cadences are intentionally configuration rather than hardcoded behavior. | Add a visual playbook builder and versioned approval templates next. |
| Voice media | Browser capture/STT boundary exists; direct telephony, SIP, and dialler adapters are not productized. | Add provider-specific media adapters only after selecting the dialler/telephony stack. |
| Enterprise analytics | Management intelligence and targets are present; advanced forecasting, territories, quota pacing, and coaching history are not complete. | Add a data warehouse/event model only once enough real usage exists. |
| Native mobile/offline | The product is a responsive web application; no native mobile app or offline mode is included. | Defer unless field-sales requirements justify it. |
| Compliance operations | Technical controls exist, but legal retention schedules, consent wording, DPA, and regional compliance configuration are organisation decisions. | Establish a policy pack before retaining any additional call media or using outbound automation at scale. |

## 5. Recommended Additions for a More Complete Sales Assistant

The recommended order protects reliability and operational value before adding more automation.

| Priority | Addition | Why it matters | Suggested release timing |
|---|---|---|---|
| **P0** | Post-deployment acceptance checklist with a test organisation | Turns the current commissioning instructions into a repeatable, auditable go-live procedure. | First day on Webdock. |
| **P0** | Production observability and alerting | Add structured error monitoring, service/worker health alerts, backup-age alerts, and connector-verification failure alerts. | Before relying on automation for daily operations. |
| **P0** | Data retention and privacy controls | Add configurable transcript/audit retention, export/deletion workflows, role-based audit access, and organisation policy records. | Before high-volume customer data is processed. |
| **P1** | Versioned playbook/template builder | Let managers create, review, publish, roll back, and measure neutral sales sequences without code changes. | First operational enhancement. |
| **P1** | Connector sync jobs and webhook intake | Add cursor-based scheduled sync, webhook signature verification, dead-letter/retry visibility, and an operator sync console for the CRM(s) actually launched. | After the first CRM provider is authorised. |
| **P1** | Lead prioritization work queue | Combine CRM changes, callbacks, pipeline mapping, call signals, and human-defined scoring rules into a daily ranked queue. | After a few weeks of real CRM data. |
| **P1** | Reply/inbox integration | Add review-first inbound email classification and suggested replies after selecting the actual mailbox provider. | After SMTP/Graph setup is stable. |
| **P2** | Conversation QA and coaching scorecards | Add manager-defined rubric scoring, sampled review queues, calibration feedback, and coaching history. | Once sufficient call volume exists. |
| **P2** | Forecasting and capacity planning | Use real won/lost outcomes, targets, stage mappings, and activities to build explainable forecasting. | After data quality is proven. |
| **P2** | Enterprise SSO/SCIM | Supports larger customers and centralized lifecycle management. | When enterprise procurement requires it. |
| **P2** | Voice selection/TTS output | Add optional human-sounding TTS and voice selection only where a clear approved use case exists; do not use it to bypass consent or review. | After the outbound communication policy is approved. |

## 6. Final Decision

**YES — deploy this release to Webdock.** The current release branch has passed the available local and hosted code/package gates, contains the requested exports, saved-item functionality, API feedback, and audit documentation, and has no identified source-code blocker.

**NO — do not represent it as fully live-proven until commissioning is complete.** Webdock launch, migrations, DNS/TLS, SMTP delivery, and every enabled external provider must be verified in the real target environment. The release documentation correctly frames these as installation-time actions and does not require secrets in source control.
