# Full-Scope Platform Contract

This contract converts the complete-sales-assistant requirement into provider-neutral, organisation-scoped software work. It does not substitute configuration flags for functionality: each capability has durable state, active-organisation boundaries, tested decision controls, audit/operational evidence, and a review-first boundary where an external action can occur. The delivered records and service contracts are activated only after a Webdock operator supplies and verifies the corresponding real account or provider configuration.

| Capability | Persisted contract | Controlled behavior |
|---|---|---|
| Compliance | Policy, data-subject request, operational event, dry-run retention worker | No record is removed by a timer; destructive execution requires an auditable approved request. |
| Playbooks | Immutable playbook revisions, approval-template records, execution-history records | Managers create drafts and publish/republish revisions; runtime resolution fails closed unless exactly one revision is published. |
| Connector operations | Verified sync job, webhook receipt, retry/dead-letter state, alert delivery record | HMAC intake is denied unless the connector is ready, capability-verified, and secret-configured. |
| Prioritisation | Evidence-led score, band, and reason list | Ranking is explainable and only uses supplied CRM, callback, task, opportunity, and call evidence. |
| Inbound communications | Inbound message, classification, reviewable reply draft | Opt-out signals are classified distinctly and a reply cannot send unless separately approved. |
| Coaching QA | Configurable rubric, scorecard, calibration/coaching record | Weighted scoring is transparent, attributable, and manager-governed. |
| Forecasting | Territory, quota period, snapshot, factual opportunity inputs | Forecasts retain configured probability evidence and methodology instead of presenting opaque predictions. |
| Enterprise identity | SAML/SCIM connection configuration and durable lifecycle state | No identity provider is activated until it is verified during Webdock installation. |
| Entitlements | Self-hosted entitlement record and provider-neutral enforcement guard | No billing provider is assumed; inactive, disabled, or exhausted capabilities fail closed. |
| TTS | Voice profile, consent state, and approved generation request | Generation requires recorded consent, an active voice policy, and a reviewed request; no unreviewed delivery path exists. |
| Observability | Structured event, rule, delivery, and worker-run ledgers | Events create only severity/category-matched pending deliveries; destination delivery remains a separately verified operator action. |

All records are scoped to the signed active organisation and use additive migrations. Provider-specific credentials remain encrypted installation-time configuration and are never committed.
