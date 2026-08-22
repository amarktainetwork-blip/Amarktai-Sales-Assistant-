# Production Acceptance Checklist

This checklist is the release gate for the self-hosted Amarktai Sales Assistant. It separates **source/build evidence** from **Webdock commissioning evidence**. A PASS means the listed command or inspection succeeded in the stated environment; it does not extend to an external service that was not contacted.

## Local repository gates

| Gate | Command or evidence | Local status | What it proves |
| --- | --- | --- | --- |
| Locked dependency installation | `pnpm install --frozen-lockfile` | Required in CI | The committed lockfile is reproducible. |
| Unit and regression suite | `pnpm test` | Required in CI and final release gate | Core controls and deterministic business rules pass. |
| TypeScript | `pnpm check` | Passed during production pass | Typed source compiles without errors. |
| Standalone production build | `pnpm build` | Passed during production pass | Vite client assets and bundled Express server build into `dist`. |
| Local assets | `test -f dist/public/assets/hero-white-model.png` and favicon check | Passed during production pass | Required public visual assets are local in the production output. |
| Production artifact health | Temporary `PORT` smoke run against `/healthz` | Passed during production pass | Built server starts and returns `{"status":"alive"}`. |
| Unconfigured readiness | Same smoke run against `/readyz` | Expected `503` locally | Readiness fails closed without actual production configuration. |
| Generic runtime isolation | Active-source audit excluding the intentionally inactive preset | Passed during production pass | No default Course2Career/Cyber/customer sender or stage leaks into generic server/client source. |
| Managed dependency removal | Tracked-source audit for Forge, hosted scheduler, owner-notification, OAuth/runtime plugin terms | Passed during production pass | Active source has no managed production path. |
| SSRF protection | `pnpm vitest run server/companyDiscovery.test.ts` | Passed during production pass | Private destinations, credentials, custom ports, redirects, and non-HTML responses are rejected. |
| CRM freshness guard | `pnpm vitest run server/crmRouter.test.ts` | Passed during production pass | Only fresh server-verified Genie capability routes are executable. |
| Scheduler behavior | `pnpm vitest run server/dailyReports.test.ts` | Passed during production pass | Due, duplicate-claim skip, and failure retry behavior are deterministic. |
| Clean scheduler migrations | Reviewed `drizzle/0007_easy_echo.sql` and `drizzle/0008_wise_terrax.sql`, then queried development DB columns | Passed during production pass | Obsolete hosted task UID/index removed; daily-report claim/attempt and execution-ledger schema applied. |
| Shell syntax | `sh -n deploy/webdock/*.sh scripts/*.sh` | Passed during production pass | Installer/operator scripts have valid POSIX shell syntax. |
| Compose definition | `docker compose -f deploy/webdock/docker-compose.yml --env-file .env config -q` | Pending CI/VPS | Local Docker CLI is unavailable. GitHub CI executes this gate. |
| Image build | `docker build -f deploy/webdock/Dockerfile -t amarktai-sales-assistant:ci .` | Pending CI/VPS | Local Docker CLI is unavailable. GitHub CI executes this gate. |

## Webdock commissioning gates

Run these only on the authorised VPS after installing real values in `/opt/amarktai-sales-assistant/.env`.

| Gate | Command | Expected evidence |
| --- | --- | --- |
| Compose deployment and migrations | `./deploy/webdock/install.sh` | Healthy MariaDB, application, worker, Browserless, and Caddy services; migration success. |
| Application readiness | `./deploy/webdock/verify-production.sh` | `/healthz` and `/readyz` are successful; mandatory SMTP transport verifies. |
| Public TLS and security headers | `VERIFY_PUBLIC_URL=https://your-domain ./deploy/webdock/verify-production.sh` | Public HTTPS plus HSTS, CSP, and `nosniff` response headers. |
| Local authentication and SMTP 2FA | Browser sign-in with the configured local administrator | A real six-digit code arrives, validates, and opens the protected workspace. |
| Authenticated Company Setup smoke | In the workspace: save Company Profile, preview one public website, explicitly confirm selected knowledge, register one CRM profile, save one review-first playbook, then refresh each panel. | Each record persists only in the authenticated workspace; discovery remains review-first; the CRM profile remains non-executable until Verify on server succeeds. |
| Optional GenX | Configure endpoint/key/model, then run verifier | Models endpoint accepts the selected model and minimal completion succeeds. |
| Optional Genie CRM | Register connection, configure authorised credentials/selectors, choose Verify on server | Server-owned fresh verification result and expiry are displayed. |
| Deliberate CRM writes | Prepare then approve one non-critical proposal at a time | Calibrated selectors, evidence, audit event, idempotency, and expected CRM result. |
| Optional Outlook | Configure and deliberately test only after an implementation exists | Sender/permissions and real external operation are confirmed; until then it remains configuration-only. |

> **Release rule:** Failure or absence of any VPS-only gate prevents a claim that the relevant external integration is live. It does not invalidate the source-release package, but it must be stated in the deployment status and operator handover.
