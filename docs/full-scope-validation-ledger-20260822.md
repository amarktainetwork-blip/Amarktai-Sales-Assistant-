# Full-Scope Validation Ledger — 2026-08-22

This is a **non-final progress ledger** for `release/go-live-20260822`. It records repeatable repository evidence after the full-scope platform expansion. The final handoff must use the exact mandated evidence fields and only one final status value.

| Validation area | Current evidence | Result |
|---|---|---|
| Type safety | `pnpm check` | Passed |
| Regression suite | `pnpm test` | 36 files, 79 tests passed |
| Production bundle | `pnpm build` | Passed; includes application, report worker, Genie health worker, and retention worker |
| Drizzle history | `pnpm drizzle-kit check` | Passed |
| Deployment scripts | `sh -n` against installer, preflight, update, backup, smoke test, and health launcher | Passed |
| Active generic-product docs | Customer-specific scan excluding the historical source extract | Passed |
| Managed-runtime source boundary | No managed runtime/storage references in production client/server/deploy search | Passed in the local source scan |
| Required remote | `https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git` | Restored after each checkpoint |
| Prior GitHub evidence | Run `32580740286` for `4e91b187c4f2705ccbe031fc1a8fd7b863727c00` | Completed successfully |

## Added Full-Scope Code Contracts

Migrations `0014` through `0018` are additive and reviewed. They provide organisation-scoped compliance policy and data-subject request records; operational event, alert, delivery, and worker records; enterprise identity and entitlement records; immutable playbook/template/execution records; connector sync and signed-webhook receipts; inbound review records; QA/coaching records; territory/quota/forecast records; and consent-governed TTS records.

The associated service boundaries are tested to fail closed: published-only playbook resolution, HMAC/capability-gated webhook intake, bounded alert retries, factual priority scoring, review-gated inbound replies, weighted QA scoring, transparent probability-weighted forecasts, entitlement enforcement, retention dry-runs, and approved/consented TTS generation.

## Target-Environment Acceptance Still Required

These are not missing repository features. They require a real Webdock host, DNS/TLS endpoint, MariaDB/Valkey containers, authorised provider accounts, and installation-time secrets that are intentionally absent from source control.

| External acceptance action | Exact target-only evidence required |
|---|---|
| Apply migrations | Webdock MariaDB migration output for `0014`–`0018` with a target database backup recorded first |
| Bring up profiles | `docker compose` full and pilot profile health output on the target VPS |
| Validate `/healthz` and `/readyz` | HTTPS responses through the target Caddy/domain configuration |
| Validate local auth and SMTP 2FA | A target mailbox receives and completes the second-factor flow |
| Verify CRM/Graph/STT/TTS/IdP connections | Authorised account-specific verification evidence; no provider is represented as ready before this proof exists |
| Validate backup, recovery, retention and alert delivery | Target backup artifact/age, restore drill evidence, worker logs, and delivery receipts |

The sandbox has no Docker CLI, so compose/image execution cannot be performed here. This does not alter the validated repository build, script-syntax, migration-history, or test evidence above.
