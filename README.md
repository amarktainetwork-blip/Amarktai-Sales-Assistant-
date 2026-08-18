# Amarktai AI Sales Assistant

**Amarktai AI** is a blue-and-white, governed sales-intelligence workspace for the Course2Career pilot. It combines a modern public product site, secure workspace access, specialized GenX agents, review-first workflow planning, call coaching, approved knowledge retrieval, and controlled CRM and Outlook connection paths. It is **Part of Amarktai Network**.

> The system separates intelligence from execution. A user instruction can be routed, clarified, planned and reviewed, but no external CRM or communication action may run without an owned, approved action proposal and a verified integration contract.

## What is implemented

| Area | Capability |
| --- | --- |
| Product and workspace | Responsive blue-and-white Amarktai AI website, secure access screen, protected command centre, workflow studio, agent desk, live call desk, knowledge hub, and connection centre. |
| Secure self-hosting | Webdock-local administrator login mode, signed server session, app-level email second factor, role-aware backend procedures, and server-side secret handling. |
| Supervisor Agent | Deterministic natural-language routing for first contact, Cyber post-consultation, Cyber final close, call coaching, knowledge, and operational analytics requests. It identifies required inputs and preserves review-first controls. |
| Specialist agents | Supervisor, Workflow Guardian, CRM Context, Conversation Coach, Programme Knowledge, Communications, Notes & Summary, QA & Compliance, and Analytics roles. Model-backed roles use GenX when configured. |
| Workflow governance | First contact, Cyber final close, and Cyber post-consultation rules are stored as reviewable action proposals with idempotency keys, historical-record protection, and immutable audit entries. |
| Genie CRM bridge | Playwright/Browserless bridge using a Genie login, reviewed saved scripts, execution evidence, and action results. **No Genie API key is used.** |
| Call intelligence | Persisted live-call sessions, transcript chunks, GenX coaching tips, factual post-call summaries, and review-ready call notes. A real-time transcription provider can be connected at deployment. |
| Knowledge grounding | Approved programme and policy sources are stored per workspace and injected into the Programme Knowledge Agent only when relevant. |
| Outlook readiness | Microsoft Graph application-token support, deployment readiness checks, and saved-template email validation that rejects missing recipients, bodies, template names, and blank subjects. |
| Operational intelligence | Review, approved, executed, blocked, callback and call-session analytics, plus an append-only audit API. |
| Deployment | Webdock Docker Compose package for Caddy, app, worker, MariaDB, Redis, Browserless Chromium, persistent script calibration, screenshots, and Genie health checks. |

## Architecture

```text
Public product site + protected Amarktai AI workspace
        │
        ├── Supervisor Agent ──► specialist agents and governed workflow router
        ├── Review queue ──────► owned proposals, approvals, execution evidence
        ├── Live call service ─► transcript → coaching → factual summary
        ├── Knowledge service ─► approved programme and policy context
        └── Integration layer ─► Genie browser bridge / Outlook Graph / GenX

Webdock VPS ── Caddy ── Node app ── MariaDB + Redis + Browserless worker
```

## Development

Install dependencies and start the application.

```bash
pnpm install
pnpm dev
```

Run all local quality checks before committing.

```bash
pnpm test
pnpm check
pnpm build
```

The development database uses the MySQL-compatible `DATABASE_URL` supplied to the project. Schema changes are defined in `drizzle/schema.ts`, generated through Drizzle, and stored under `drizzle/`.

## Webdock VPS installation

The deployable package is in [`deploy/webdock`](deploy/webdock). It provisions Caddy, the application, a Genie health worker, MariaDB, Redis, and Browserless Chromium. Read the complete [Webdock VPS installation guide](docs/webdock-vps-install.md) before starting.

```bash
git clone https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant.git /opt/c2c-assistant
cd /opt/c2c-assistant
cp deploy/webdock/configuration.template .env
nano .env
chmod +x deploy/webdock/install.sh scripts/run-genie-health-check.sh
./deploy/webdock/install.sh
```

After the first deployment, validate containers and application logs.

```bash
docker compose -f deploy/webdock/docker-compose.yml --env-file .env ps
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs --tail=150 app worker
```

## First-install configuration

The complete configuration template is [`deploy/webdock/configuration.template`](deploy/webdock/configuration.template). Place real values only in `/opt/c2c-assistant/.env`; never commit that file.

| Group | Required values |
| --- | --- |
| Application and infrastructure | `DOMAIN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `JWT_SECRET`, `SECRET_KEY`, `BROWSERLESS_TOKEN` |
| Webdock-local access | `AUTH_MODE=local`, `VITE_AUTH_MODE=local`, `LOCAL_ADMIN_NAME`, `LOCAL_ADMIN_EMAIL`, `LOCAL_ADMIN_PASSWORD` |
| GenX | `GENX_CHAT_COMPLETIONS_URL`, `GENX_API_KEY`, `GENX_DEFAULT_MODEL` |
| Genie browser automation | `GENIE_LOGIN_URL`, `GENIE_USERNAME`, `GENIE_PASSWORD`, and reviewed `GENIE_*_SELECTOR` values |
| Outlook / Microsoft Graph | `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_SENDER_EMAIL` |
| Email second factor and daily reports | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |

There is deliberately no `GENIE_CRM_API_KEY`. Genie is controlled through the dedicated browser service with an authorised login and saved Playwright scripts. The installer creates `config/genie-scripts.json` from `deploy/webdock/genie-scripts.template.json`. Every `REPLACE_*` selector and the Genie search URL must be calibrated using an authorised live session before a browser write is activated.

## Operational safety rules

The Course2Career rules encoded in the project include the approved SMS sender `+447428000560`, saved-template communication requirements, blank-subject email prevention, task and opportunity historical-record protection, first-contact progression, Cyber final closure rules, and the Cyber post-consultation no-answer/voicemail branch.

The system must stop and report the exception rather than substitute an action when it cannot verify an active task, current opportunity, required template, valid recipient, correct sender, consent, or duplicate protection condition.

## Documentation

The primary operational guide is [`docs/webdock-vps-install.md`](docs/webdock-vps-install.md). It covers VPS setup, HTTPS, backups, Genie selector calibration, deployment health checks, recovery steps, and the persistent Browserless worker. Additional provider research is retained in [`docs/integration-research.md`](docs/integration-research.md).
