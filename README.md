# Amarktai Sales Assistant

**Amarktai Sales Assistant** is a governed sales-operations workspace built for the Course2Career pilot. It combines role-specific GenX agents, review-first workflow planning, a protected action queue, call-note capture, approved knowledge sources, and controlled CRM/email integrations. It is branded as **Part of Amarktai Network**.

> The system is designed so that a workflow is prepared, reviewed, and auditable before an external CRM or communication change is executed. It does not invent candidate facts, rewrite saved communications, reopen historical records, or create duplicate follow-up work.

## Product capabilities

| Area | Current implementation |
| --- | --- |
| Public website and secure workspace | Responsive product site, secure organization sign-in, and an app-level email second-factor gate once SMTP is configured. |
| Sales workflow governance | First contact, Cyber final close, and Cyber post-consultation workflows are converted into reviewable action proposals with idempotency keys and historical-record safeguards. |
| Multi-agent experience | Workflow Guardian, CRM Context, Conversation Coach, Programme Knowledge, and Communications agent roles route requests through the configured GenX model provider. |
| Genie CRM | A Playwright/Browserless browser bridge uses `GENIE_LOGIN_URL`, username, password, and reviewed selectors. **No Genie API key is used.** |
| Outlook | Microsoft Graph connection settings are ready for a verified Entra application and least-privilege mail/calendar implementation. |
| Knowledge and call notes | Authenticated knowledge-source management and factual call-note capture are persisted in the database. |
| Safety and auditability | Action proposals, workflow runs, integration profiles, call sessions, and audit entries are tenant-scoped and persisted. |

## Architecture

```text
GenX                       → model-routing brain
Webdock VPS                → persistent operations centre
Browserless + Playwright   → controlled Genie CRM browser automation
Microsoft Graph            → Outlook mail and calendar connection
MariaDB                    → application memory and audit trail
Redis                      → operational queue/cache foundation
Approval queue             → human safety boundary for external actions
12-hour worker             → Genie login/layout health check
```

The browser bridge follows the source brief’s **learn once, save script, replay script** model. GenX is reserved for intelligence, exception handling, repairs, and new work; it is not used to reinterpret the entire Genie screen for every repetitive action.

## Development

Install dependencies and start the application locally.

```bash
pnpm install
pnpm dev
```

Run quality checks.

```bash
pnpm test
pnpm check
pnpm build
```

The regular development database must use the MySQL-compatible `DATABASE_URL` configured for this project. Database changes are managed through Drizzle migrations under `drizzle/`.

## Webdock VPS deployment

The deployable installation package is under [`deploy/webdock`](deploy/webdock). It starts Caddy, the full-stack app, the Genie health worker, MariaDB, Redis, and Browserless Chromium as a Docker Compose stack. Start with the complete [Webdock VPS installation guide](docs/webdock-vps-install.md).

```bash
git clone https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant.git /opt/c2c-assistant
cd /opt/c2c-assistant
cp deploy/webdock/configuration.template .env
nano .env
chmod +x deploy/webdock/install.sh scripts/run-genie-health-check.sh
./deploy/webdock/install.sh
```

## Required first-install configuration

The exact variable template lives in [`deploy/webdock/configuration.template`](deploy/webdock/configuration.template). Add every production value to `/opt/c2c-assistant/.env` before the first build.

| Group | Required values |
| --- | --- |
| Application and infrastructure | `DOMAIN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `JWT_SECRET`, `SECRET_KEY`, `BROWSERLESS_TOKEN` |
| GenX | `GENX_CHAT_COMPLETIONS_URL`, `GENX_API_KEY`, `GENX_DEFAULT_MODEL` |
| Genie browser automation | `GENIE_LOGIN_URL`, `GENIE_USERNAME`, `GENIE_PASSWORD`, and the reviewed `GENIE_*_SELECTOR` values |
| Outlook | `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET` when activating Microsoft Graph features |
| Email second factor and daily reports | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` when activating email delivery |

There is deliberately no `GENIE_CRM_API_KEY`. Genie is integrated through the dedicated browser service using the account’s login credentials and saved, reviewable Playwright scripts.

## Source-specific workflow rules

The implementation encodes the key Course2Career guardrails included in the supplied brief. This includes the mandatory SMS sender number `+447428000560`, template-only communications, task/opportunity historical-record protection, the First Call-to-Call 2 sequence, Cyber final closure rules, and the Cyber post-consultation branch that only sends failed-contact communications for no-answer or voicemail outcomes.

## Integration research

See [`docs/integration-research.md`](docs/integration-research.md) for verified Microsoft Graph considerations and the browser-automation constraint for Genie. The system must not make an external change until its provider contract, credentials, selectors, and approval policy are verified.
