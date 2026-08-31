# Amarktai Sales Assistant — release truth

This checklist tracks the current trailing-hyphen repository. Historical wish lists and completed recovery work have been removed so unchecked items do not imply missing code that already exists.

## Implemented in the application

- [x] Self-hosted local authentication, email second factor, recovery, organisation selection and tenant isolation.
- [x] Company profile, bounded public-website discovery, structured facts, provenance, conflict detection and explicit human approval.
- [x] Provider-neutral CRM model with Genie, custom browser CRM, HubSpot, Salesforce, Pipedrive and Zoho connector boundaries.
- [x] Today prioritisation, customer context, pre-call preparation, consented live-call companion, transcript/coaching, confirmed closeout and review-first CRM actions.
- [x] Approvals, action evidence/readback, audit history, automation policies, manager controls, CSV/PDF exports and a distinct Reports page.
- [x] Shared commercial plan source in `shared/pricing.ts`, truthful public pricing and secure public contact delivery.
- [x] Provider-neutral Secure CRM Browser with direct customer sign-in, isolated organisation/connection sessions and explicit human/agent control.
- [x] Strict client acceptance that requires `LIVE_PROVEN` for every critical customer-specific feature.
- [x] One coherent public/product visual direction with responsive navigation, focus states and reduced-motion handling.

## Release validation

- [x] Complete local unit, type, migration, build, secret, dependency, shell and diff gates for the final release diff.
- [x] Complete visual inspection at 1440, 1024, 768 and 390 pixels without customer data.
- [ ] Open the final pull request and obtain green `CI` and `Persistent Browser Profile` workflows.
- [ ] Merge the green pull request and record the merged main SHA.

## EXTERNAL_COMMISSIONING_REQUIRED

These items require the deployed environment, authorised accounts or a customer-controlled second factor. They must not be marked complete from mocks or source inspection.

- Deploy merged main using the safe production sequence; preserve MariaDB, Valkey, users and company knowledge.
- Run the production platform verifier and obtain `PLATFORM_READY=PASS`.
- Perform one controlled Genie authentication entirely inside the Secure CRM Browser; Amarktai must not receive the CRM password or verification code.
- Calibrate and live-prove only the capabilities exposed by the authorised Genie account, using the dedicated safe test record for writes/readback.
- Run Course2Career discovery, human-review current facts and explicitly resolve any conflicting prices.
- Prove the real Assistant, call companion, closeout, CRM write/readback, activity and report journey.
- Run strict client acceptance; handover remains pending until it prints `CLIENT_ACCEPTANCE=PASS`.
- Live OAuth verification for HubSpot, Salesforce, Pipedrive or Zoho remains account-specific. An installed/tested adapter is not a live-connected account.
