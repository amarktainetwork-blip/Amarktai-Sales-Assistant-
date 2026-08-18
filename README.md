# Amarktai Network Sales Assistant

**Amarktai Network Sales Assistant** is a governed sales-operations application for the Course2Career pilot. It provides a public product site, secure workspace access, a real data-backed operations dashboard, workflow preparation, review queues, call-context capture, approved knowledge, connection readiness, and a retained operational audit trail.

> The application is deliberately review-first. It can prepare work and retain decisions, but it must not claim that an external CRM, message, calendar, or email action occurred unless the configured integration reports the result and records the evidence.

## Read the current implementation status first

The source brief describes a much larger system than is currently live. Before installing or evaluating this project, read the code-grounded status report at [`docs/implementation-status.md`](docs/implementation-status.md).

It separates features into three states:

| State | Meaning |
| --- | --- |
| **Built** | The interface and backend contract exist in this repository. |
| **Configuration-dependent** | The code exists but needs real production credentials, a permitted account, or calibration on Webdock before it can operate. |
| **Not yet built** | The source brief calls for it, but this repository does not yet provide the complete data model, service, or end-to-end interface. |

## What is available now

| Product area | Current capability |
| --- | --- |
| Operations dashboard | A data-backed dashboard for review load, callbacks, overdue and due-today work, live/reviewable calls, workflow activity, connection profiles, and audit activity. |
| Controlled workflows | First contact, Cyber final close, and Cyber post-consultation paths create reviewable action proposals with idempotency and historical-record safeguards. |
| Review and evidence | Proposed actions can be approved or skipped. Approved CRM actions have a guarded execution route with normalized evidence status and proposal-specific audit history. |
| Secure access | A self-hosted administrator sign-in path, signed sessions, role field, and email second-factor implementation are included. Live email verification needs SMTP configuration. |
| Call desk | Manual live-call sessions, factual notes/transcript capture, coaching request contract, and post-call summary contract are included. Audio and telephony ingestion are not yet included. |
| Knowledge | Approved notes and URLs can be added and used to ground the knowledge guidance route. Advanced document ingestion and vector search are not yet included. |
| Connections | Browser-automation, Microsoft Graph, email, and intelligence-provider readiness/configuration surfaces exist. A real connection must be configured and tested before it is treated as active. |

## Local development

```bash
pnpm install
pnpm dev
```

Run the required checks before committing:

```bash
pnpm test
pnpm check
pnpm build
```

## Webdock VPS package

The self-hosted deployment package is located in [`deploy/webdock`](deploy/webdock). It includes the application container, reverse proxy configuration, MariaDB, Redis, Browserless Chromium, a CRM health worker, an environment template, and operational scripts.

```bash
git clone https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant.git /opt/amarktai-network
cd /opt/amarktai-network
cp deploy/webdock/configuration.template .env
nano .env
chmod +x deploy/webdock/install.sh scripts/run-genie-health-check.sh
./deploy/webdock/install.sh
```

The Webdock package has been packaged and syntax-checked in development, but it still needs an end-to-end run on the target VPS. The installation guide at [`docs/webdock-vps-install.md`](docs/webdock-vps-install.md) documents the required production configuration, CRM selector calibration, and health-check steps.

## Integration safety

The browser CRM bridge intentionally has **no CRM API key**. It requires an authorised login, reviewed saved scripts, calibrated selectors, and evidence capture. Microsoft Graph mail/calendar capability is likewise configuration-dependent until the tenant, application permissions, sender, and test mailbox have been verified.

The customer-facing application is branded as **Amarktai Network**. Provider names and credentials are technical deployment details, not product branding.
