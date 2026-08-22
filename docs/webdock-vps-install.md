# Webdock VPS Installation

This repository deploys Amarktai Sales Assistant on Webdock with React/Vite + Express/tRPC, MariaDB, Valkey (Redis protocol), Caddy and a self-hosted Chromium/CDP browser runtime in the full profile. GenX remains the application's generative/reasoning AI router. Genie uses authorised deterministic browser automation; HubSpot uses OAuth/API.

The small VPS is a **pilot target only**. It does not define the production architecture.

## 1. Server

Use Ubuntu 24.04, a non-root sudo user and SSH keys. Permit only the network services you need (normally SSH, HTTP and HTTPS). Install Docker Engine and the Docker Compose plugin from Docker's current Ubuntu instructions.

```bash
docker --version
docker compose version
```

For a production deployment that self-hosts Chromium, size the host from measured concurrency rather than the pilot specification. For a small test VPS use the pilot profile and an external authorised Chromium/CDP endpoint.

## 2. Clone the correct repository

```bash
sudo mkdir -p /opt/amarktai-sales
sudo chown "$USER":"$USER" /opt/amarktai-sales
git clone https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git /opt/amarktai-sales
cd /opt/amarktai-sales
git checkout release/go-live-20260822
cp deploy/webdock/configuration.template .env
chmod 600 .env
nano .env
```

Generate the connection-secret encryption key with:

```bash
openssl rand -base64 32
```

Put the result in `CONNECTION_SECRETS_MASTER_KEY`. Replace every required template value. Do not commit `.env`.

## 3. Choose a deployment profile

### Pilot / small test VPS

The pilot profile runs Caddy, the application, worker, report scheduler, MariaDB and Valkey locally, but connects to an external Chrome/Chromium CDP service. Set the compatibility variable `BROWSERLESS_WS_ENDPOINT` to that authorised endpoint, then run:

```bash
AMARKTAI_DEPLOY_PROFILE=pilot sh deploy/webdock/install.sh
```

The external service does not have to be Browserless; the application consumes a Playwright-compatible CDP endpoint. If you choose a commercial service, verify its licence and pricing separately.

### Full / self-hosted Chromium

The full profile builds the repository's own internal Chromium/CDP image from `deploy/browser/Dockerfile`. No Browserless token or commercial browser-service licence is required.

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/install.sh
```

The Chromium DevTools port is internal to the Compose network and is not published to the internet.

The installer runs a preflight before building, verifies the Compose configuration, creates the correct bind-mount directories under `deploy/webdock/`, applies migrations, and starts the selected profile.

## 4. DNS and TLS

Point `DOMAIN` to the VPS before expecting public TLS to become healthy. Caddy obtains and renews certificates automatically.

After deployment:

```bash
curl -fsS "https://$DOMAIN/healthz"
```

Expected application response includes a healthy service result. Check database-aware readiness separately with:

```bash
curl -fsS "https://$DOMAIN/readyz"
```

## 5. HubSpot

Create/configure the HubSpot app and register exactly:

```text
https://YOUR_DOMAIN/api/crm/oauth/callback
```

Set `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`. A saved system is not marked ready merely because OAuth succeeded; the backend tests the requested scopes and read capabilities.

Do not put HubSpot access/refresh tokens in `.env`; Amarktai stores connection material encrypted per connected system.

## 6. Genie calibration

Genie has no assumed API key. Configure the authorised login URL/account and login selectors. The first pilot still uses the install-level Genie login values; multi-customer production must move authenticated browser state to organisation-scoped encrypted sessions rather than sharing one account.

The installer creates:

```text
deploy/webdock/config/genie-scripts.json
```

from the template when absent. Every `REPLACE_*` selector must be calibrated against the authorised Genie environment before writes are enabled.

Run a health check in the selected profile:

```bash
# Pilot
AMARKTAI_DEPLOY_PROFILE=pilot docker compose -f deploy/webdock/docker-compose.pilot.yml --env-file .env run --rm worker /app/scripts/run-genie-health-check.sh

# Full
AMARKTAI_DEPLOY_PROFILE=full docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --rm worker /app/scripts/run-genie-health-check.sh
```

Browser evidence is persisted under:

```text
deploy/webdock/files/connector-evidence/
```

Do not claim Genie live-ready until the actual customer domain, login, selectors and saved scripts have been tested with an authorised account.

## 7. Live Call Companion

To enable live transcription, point the application at an authorised OpenAI-compatible speech-to-text endpoint:

```text
STT_PROVIDER_LABEL=Self-hosted speech-to-text
STT_TRANSCRIPTIONS_URL=https://your-stt-host/v1/audio/transcriptions
STT_MODEL=your-model-id
STT_API_KEY=optional-provider-key
```

A self-hosted faster-whisper/Speaches-style service is suitable for evaluation. The Webdock application host does not need to run the speech model itself; production can place STT on dedicated CPU/GPU workers later.

The `/calls` workspace requires explicit browser media permission and an explicit confirmation that the organisation's transcription/consent requirements have been handled. Raw audio chunks are not retained by the current bridge.

## 8. Operations

Choose the same Compose file used for installation.

```bash
# example full profile
COMPOSE='docker compose -f deploy/webdock/docker-compose.yml --env-file .env'
$COMPOSE ps
$COMPOSE logs --tail=200 app
$COMPOSE logs --tail=200 worker
$COMPOSE logs --tail=200 reporter
```

For a routine update, use the repository's guarded update path. It runs preflight, takes a database backup, rebuilds, migrates, restarts and smoke-tests:

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/update.sh
```

For pilot, replace `full` with `pilot`.

## 9. Backup

Create an application-level MariaDB backup before schema changes and keep copies off-server according to your retention policy:

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/backup.sh
```

The script writes a compressed SQL dump plus SHA-256 checksum under `deploy/webdock/backups/`. Routinely test restoration on an isolated database. Webdock snapshots are useful additional protection, not a substitute for tested application-level backups.

## 10. Smoke test

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/smoke-test.sh
```

This checks the app health endpoint, MariaDB, Valkey and—on the full profile—the internal Chromium DevTools endpoint.

## 11. Exports, favorites, and API feedback

After a signed local session has passed the second-factor gate, the Operations Dashboard provides two protected downloads:

- **Report CSV** exports the active organisation's bounded action-proposal, callback, call-session, and audit summary.
- **Call logs PDF** exports factual call-session text for the active organisation. It does not export data from another selected workspace.

The Review Command Centre also provides private **saved favorites** and comma-separated tags for reviewable proposals. Migration `0013_magenta_fabian_cortez.sql` creates the `workspaceSavedItems` table and is applied by the standard installer/update migration step. Do not create the table manually or seed it with customer records.

The dashboard and review queue now distinguish loading, empty, and API-failure states. A retryable error normally means the local session, second-factor status, selected organisation, or network connection should be checked before retrying.

## 12. What deployment proves

A healthy deployment proves that the application, database, cache, migrations, reverse proxy and selected browser runtime start correctly. It does **not** by itself prove:

- real Genie selectors/actions;
- an authorised HubSpot account;
- SMTP delivery;
- Microsoft Graph permissions;
- real STT accuracy on the target call/audio setup.

Those require their own authorised integration tests. Keep `docs/implementation-status.md` truthful after each validation milestone.
