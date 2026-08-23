# Go-Live Audit — Post-Feature Release Candidate

**Audit scope.** This audit covers the working tree after adding protected CSV/PDF exports, workspace favorites/tags, and improved API loading/error feedback. The target is the self-hosted Webdock release branch `release/go-live-20260822`. No target VPS, DNS zone, provider account, mailbox, OAuth tenant, browser session, or API secret was supplied or used during this audit.

> **Deployment conclusion.** The repository is **code-ready for Webdock deployment**. It is not truthful to call CRM, SMTP, Graph, browser automation, STT, or TLS **live-proven** until the installer runs with authorised target credentials. Those are commissioning gates, not source-code secrets or reasons to commit placeholder values.

## Newly completed features

| Capability | Implemented behavior | Verification performed |
|---|---|---|
| Operational exports | The authenticated active organisation can download a bounded operational report as CSV and factual conversation logs as PDF. The server derives the workspace from the signed session and never accepts a client-supplied organisation ID. | Formatter regression coverage, TypeScript, 61 tests, Drizzle check, and production build passed. |
| Favourites and tags | Users can save active-workspace action proposals with up to 12 normalized tags, list saved items, update tags, and remove saved entries. The model also supports lead and pitch references. Action-proposal references are re-authorized server-side. | Additive migration `0013_magenta_fabian_cortez.sql` reviewed; tag regression coverage, TypeScript, 61 tests, Drizzle check, and production build passed. |
| API interaction feedback | Dashboard, exports, review queue, favorites, assistant, calls, workflows, and knowledge actions now expose progress labels, mutation errors, or retryable query errors rather than silently rendering missing data as empty. | TypeScript and full regression suite passed. |

## Verified code and release gates

| Gate | Result | Evidence |
|---|---|---|
| TypeScript | Passed | `pnpm check` completed successfully. |
| Unit and regression tests | Passed | **61 tests in 25 files** completed successfully. |
| Drizzle schema consistency | Passed | `pnpm drizzle-kit check` completed successfully. |
| Production build | Passed | `pnpm build` completed successfully. The only output was Vite’s non-blocking chunk-size advisory. |
| Webdock scripts | Passed | `sh -n deploy/webdock/preflight.sh` and `sh -n deploy/webdock/install.sh` completed successfully. |
| Managed-runtime audit | Passed | No executable-source matches for managed Manus/Forge runtime paths. |
| Customer hardcoding audit | Passed | No executable-source matches for customer names, legacy vertical keys, or hardcoded sender data. |
| Visual navigation check | Limited but passed | Protected `/dashboard` and `/workspace` routes correctly render the secure-access gate without a local authenticated session. The protected controls require a real local session to inspect interactively. |

## Exact remaining go-live boundaries

| Priority | FILE / FUNCTION | Reason | Exact remaining action | Deployment effect |
|---|---|---|---|---|
| Required | `deploy/webdock/preflight.sh`, `docker-compose*.yml` | The local sandbox has no Docker daemon or Webdock host, so runtime containers cannot be launched here. | On Webdock, create `.env` from `deploy/webdock/configuration.template`, run preflight, apply migrations, and launch either full or pilot Compose profile. Confirm `/healthz` and `/readyz`. | **Blocks live launch only**, not code release. |
| Required if 2FA/recovery/report email is enabled | `server/smtp.ts`, `server/twoFactor.ts`, `server/localAuth.ts` | SMTP is implemented but no authorised mail transport was supplied. | Enter SMTP secrets only in Webdock `.env`; send and receive one second-factor and one recovery email. | **Blocks live email/2FA proof**, not application installation. |
| Required for a public custom domain | `deploy/webdock/Caddyfile` | TLS issuance needs a real DNS name resolving to the VPS. | Point DNS to Webdock, configure Caddy domain settings, then verify HTTPS and secure cookies. | **Blocks public-domain TLS proof**, not internal compose start. |
| Required per CRM | `server/connectedSystems.ts`, `server/crm/*` | Provider credentials and tenant authorization must never exist in source control. | Authorise each intended connector after installation, run server verification, then test the exact allowed capabilities. | **Blocks live CRM automation only**. |
| Required for Genie/browser automation | `server/genie/*`, browser bridge configuration | No authorised Genie URL, logged-in browser session, or selectors are available in the repository. | Calibrate saved-script selectors with an authorised live session, restrict domains, and execute the documented review-first scripts. | **Blocks live Genie action proof only**. |
| Optional capability | `server/outlook.ts`, `server/genx.ts`, live-call/STT modules | Graph, GenX, and STT are optional capability boundaries and are intentionally unconfigured. | Configure only the services the organisation chooses, run the verifier, and retain the resulting evidence. | **Does not block base go-live**. |
| Recommended QA | Protected dashboard/workspace flows | The browser preview intentionally has no production local user/2FA session. | After Webdock local-admin bootstrap, test export download, saved tags, retries, company setup, provider readiness, and action review under real 2FA. | **Does not block compose install**; required before operational acceptance. |

## Remaining checklist interpretation

The checklist contains historical and commissioning-oriented open lines. They do **not** indicate an uncommitted source failure. Their common themes are target-VPS installation, authenticated end-to-end checks, live CRM/browser calibration, broader optional agent coverage, and final release publishing. The current code additions remove the requested export, tagging, and API-feedback gaps; the current audit documents their validation.

The only source-level follow-up that should be scheduled after this release is further expansion of the governed agent catalogue **when a concrete organisation-approved workflow is defined**. It is intentionally not a generic hardcoded default. All other current incomplete checklist items require an external installation environment or authorised provider account.

## Go-live decision

`DEPLOYMENT_PACKAGE_STATUS=READY_FOR_WEBDOCK_DEPLOYMENT`

`LIVE_PROVIDER_STATUS=NOT_YET_PROVEN_BY_DESIGN`

`SOURCE_CODE_BLOCKERS=NONE_IDENTIFIED_IN_THIS_AUDIT`

`COMMISSIONING_BLOCKERS=Webdock runtime launch, target migrations, SMTP delivery if enabled, DNS/TLS for public domain, and only the provider integrations the organisation elects to enable.`
