# Webdock VPS Installation

This repository deploys Amarktai Sales Assistant on Webdock with React/Vite + Express/tRPC, MariaDB, Redis, Caddy and optional local Browserless Chromium. GenX remains the application's generative/reasoning AI router. Genie uses authorised browser automation; HubSpot uses OAuth/API.

The small VPS is a **pilot target only**. It does not define the production architecture.

## 1. Server

Use Ubuntu 24.04, a non-root sudo user and SSH keys. Permit only the network services you need (normally SSH, HTTP and HTTPS). Install Docker Engine and the Docker Compose plugin from Docker's current Ubuntu instructions.

```bash
docker --version
docker compose version
```

For a production deployment that self-hosts Chromium, size the host from measured concurrency rather than the pilot specification. For a small test VPS use the pilot profile and an external Browserless endpoint.

## 2. Clone the correct repository

```bash
sudo mkdir -p /opt/amarktai-sales
sudo chown "$USER":"$USER" /opt/amarktai-sales
git clone https://github.com/sharetheherbman-debug/Amarktai-Sales.git /opt/amarktai-sales
cd /opt/amarktai-sales
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

The pilot profile runs Caddy, the application, the worker, MariaDB and Redis locally, but connects to an external Browserless websocket. Set `BROWSERLESS_WS_ENDPOINT` in `.env`, then run:

```bash
AMARKTAI_DEPLOY_PROFILE=pilot ./deploy/webdock/install.sh
```

### Full / local Browserless

The full profile also runs the pinned Browserless Chromium container. Configure `BROWSERLESS_TOKEN`, then run:

```bash
AMARKTAI_DEPLOY_PROFILE=full ./deploy/webdock/install.sh
```

The installer runs a preflight before building, verifies the Compose configuration, creates the correct bind-mount directories under `deploy/webdock/`, applies migrations, and starts the selected profile.

## 4. DNS and TLS

Point `DOMAIN` to the VPS before expecting public TLS to become healthy. Caddy obtains and renews certificates automatically.

After deployment:

```bash
curl -fsS "https://$DOMAIN/api/health"
```

Expected application response includes `"status":"ok"` and `"service":"amarktai-sales"`.

## 5. HubSpot

Create/configure the HubSpot app and register exactly:

```text
https://YOUR_DOMAIN/api/crm/oauth/callback
```

Set `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`. A saved system is not marked ready merely because OAuth succeeded; the backend tests the requested scopes and read capabilities.

Do not put HubSpot access/refresh tokens in `.env`; Amarktai stores connection material encrypted per connected system.

## 6. Genie calibration

Genie has no assumed API key. Configure the authorised login URL/account and login selectors. The first pilot still uses the install-level Genie login values; future SaaS organisations must use organisation-scoped encrypted browser sessions rather than sharing these credentials.

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

## 7. Operations

Choose the same Compose file used for installation.

```bash
# example full profile
COMPOSE='docker compose -f deploy/webdock/docker-compose.yml --env-file .env'
$COMPOSE ps
$COMPOSE logs --tail=200 app
$COMPOSE logs --tail=200 worker
```

Before updating production, take a database backup and review migrations. Then:

```bash
git pull --ff-only
$COMPOSE build
$COMPOSE run --rm app pnpm drizzle-kit migrate
$COMPOSE up -d
curl -fsS "https://$DOMAIN/api/health"
```

## 8. Backup

Create an application-level MariaDB dump before schema changes and store backups off-server according to your retention policy.

```bash
mkdir -p deploy/webdock/backups
$COMPOSE exec -T db mariadb-dump -u root -p"$DB_ROOT_PASSWORD" amarktai_sales_assistant \
  | gzip > "deploy/webdock/backups/db-$(date +%F-%H%M%S).sql.gz"
```

Routinely test restoration on an isolated database. Webdock snapshots are useful additional protection, not a substitute for tested application-level backups.

## 9. What deployment proves

A healthy deployment proves that the application, database, cache, migrations, reverse proxy and selected browser endpoint start correctly. It does **not** by itself prove:

- real Genie selectors/actions;
- an authorised HubSpot account;
- SMTP delivery;
- Microsoft Graph permissions;
- real audio capture/transcription.

Those require their own authorised integration tests. Keep `docs/implementation-status.md` truthful after each validation milestone.
