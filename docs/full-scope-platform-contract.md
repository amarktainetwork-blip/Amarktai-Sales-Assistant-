# Full-Scope Platform Contract

This contract converts the complete-sales-assistant requirement into provider-neutral, organisation-scoped software work. It does not substitute configuration flags for functionality: every feature must persist state, enforce active-organisation access, expose an operator/manager surface, emit auditable events, and remain review-first where an external action can occur.

| Capability | Persisted contract | Controlled behavior |
|---|---|---|
| Compliance | Organisation policy, retention rule, deletion/export request | No record is removed automatically without a policy and auditable execution. |
| Playbooks | Playbook versions, draft/published/retired status, template/approval metadata | Managers publish or roll back; agents use only published versions. |
| Connector operations | Sync job, webhook receipt, retry/dead-letter state | Intake is signature-verified per configured connector; unprocessed failures are visible. |
| Prioritisation | Evidence-led lead score, reason list, source timestamps | Ranking is explainable and never inferred from protected attributes. |
| Inbound communications | Inbound message, classification, reviewable reply draft | No inbound reply is sent without the existing approval boundary. |
| Coaching QA | Configurable rubric, sampled scorecard, coaching record | Manager calibration is durable and attributable. |
| Forecasting | Territory, quota period, scenario, factual pipeline inputs | Forecasts expose assumptions, pipeline stage mapping, and confidence. |
| Enterprise identity | SAML/SCIM connection configuration and provisioning event ledger | No identity provider is active until it has been verified during installation. |
| Entitlements | Plan/entitlement ledger and provider-event ledger | Billing remains disabled until a provider is configured; feature enforcement is durable. |
| TTS | Organisation voice policy and generated-audio review record | Audio requires policy/consent and cannot bypass review-first communications. |
| Observability | Structured operational event and alert-rule/alert-delivery ledger | Worker, backup, connector, and deployment failures become actionable signals. |

All records are scoped to the signed active organisation and use additive migrations. Provider-specific credentials remain encrypted installation-time configuration and are never committed.
