# Webdock VPS Installation

This deployment package implements the architecture agreed in the supplied system brief: **Webdock VPS** is the operational environment, **GenX** is the model provider, **Playwright through Browserless** is the controlled way to operate Genie CRM, **Microsoft Graph** is the Outlook connection, and an approval queue remains the safety boundary. Genie credentials are browser-login credentials; there is **no Genie API key** in this installation.

> The repository currently uses a MySQL-compatible Drizzle schema, so the packaged first installation uses **MariaDB 11.7**. This keeps the application and its migrations consistent. A later PostgreSQL/pgvector migration should be an explicit, tested data migration rather than an unverified database swap.

## 1. Provision and secure the server

Create an Ubuntu 24.04 Webdock VPS with enough capacity for the browser service and worker. The original brief recommends eight vCPUs, 16 GB RAM, 160 GB NVMe, and daily backups. Use a non-root administrator with SSH keys; disable password-based SSH after validating key access. Restrict inbound access to ports 22, 80, and 443.

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo adduser --disabled-password --gecos "" amarktai
sudo usermod -aG sudo amarktai
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Install Docker Engine and the Compose plugin using Docker’s current Ubuntu instructions, then confirm the installation.

```bash
docker --version
docker compose version
```

## 2. Install the repository and configure the first deployment

Clone this repository into the location specified by the original brief, then create the install-time environment file. Every operational credential is entered before the stack starts. Do not commit the resulting `.env` file.

```bash
sudo mkdir -p /opt/c2c-assistant
sudo chown amarktai:amarktai /opt/c2c-assistant
git clone https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant.git /opt/c2c-assistant
cd /opt/c2c-assistant
cp deploy/webdock/configuration.template .env
nano .env
```

The following values are required before activation: a domain name, database passwords, `JWT_SECRET`, `SECRET_KEY`, `BROWSERLESS_TOKEN`, the GenX endpoint/key/default model, and the Genie login URL/username/password. Microsoft Graph and SMTP values are required to activate their corresponding features. **Do not add a Genie API key**: Genie is operated through the saved Playwright scripts in the browser service.

### Local administrator login

The deployed application does not use a managed identity page. In `.env`, set `AUTH_MODE=local` and `VITE_AUTH_MODE=local`, then enter `LOCAL_ADMIN_NAME`, `LOCAL_ADMIN_EMAIL`, and a unique `LOCAL_ADMIN_PASSWORD` of at least 12 characters. On the first local login, the application creates this administrator account from the server-side values; the password is hashed and the source `.env` file remains outside Git.

SMTP is required for the production email verification step. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` to a mailbox controlled by the administrator. The disposable **Open dashboard preview** control appears only while the application is running in development; it is disabled in the production Docker deployment and is not a production account.

### Reset or rotate the local administrator credentials

The initial administrator is intentionally created once, so changing `LOCAL_ADMIN_PASSWORD` in `.env` alone does not replace the already-hashed password. Use the following controlled recovery procedure on the Webdock server. It changes no CRM, company, workflow, or audit data.

```bash
cd /opt/c2c-assistant
nano .env
# Set a new LOCAL_ADMIN_PASSWORD and, if required, a new LOCAL_ADMIN_EMAIL.

# Remove only the existing local administrator account; preserve all other users and operational records.
docker compose -f deploy/webdock/docker-compose.yml --env-file .env exec -T db \
  mariadb -u root -p"$DB_ROOT_PASSWORD" amarktai_sales_assistant \
  -e "DELETE FROM users WHERE openId LIKE 'local:%';"

# Restart the app. The first login with LOCAL_ADMIN_EMAIL re-creates the administrator using the new password.
docker compose -f deploy/webdock/docker-compose.yml --env-file .env up -d app
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs --tail=100 app
```

Sign in once using the new `LOCAL_ADMIN_EMAIL` and `LOCAL_ADMIN_PASSWORD`, request a six-digit email code, and confirm the dashboard opens. If you have more than one local user in the future, replace the broad recovery deletion with a reviewed, email-specific database operation.

## 3. DNS, TLS, and first start

Point an A or AAAA DNS record for `DOMAIN` at the Webdock server. Caddy obtains and renews TLS automatically after the domain resolves publicly. Build the stack and run the database migrations with the included installer.

```bash
chmod +x deploy/webdock/install.sh scripts/run-genie-health-check.sh
./deploy/webdock/install.sh
```

The services are Caddy, the application API/web server, the 12-hour Genie health worker, MariaDB, Redis, and Browserless Chromium. The browser is not public; only the application and worker access it over the internal Docker network.

## 4. Initial Genie browser-script calibration

The provided login script is deliberately selector-driven. During the first secure calibration, edit the `GENIE_*_SELECTOR` values in `.env` to match the real Genie login page, then verify from within the worker container.

```bash
docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --rm worker /app/scripts/run-genie-health-check.sh
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs --tail=100 worker
```

After the login and dashboard checks succeed, calibrate `/opt/c2c-assistant/config/genie-scripts.json`. The installer creates it from `deploy/webdock/genie-scripts.template.json`; every `REPLACE_*` selector must be changed to a reviewed Genie selector before a browser write can run. The required saved scripts are candidate search, history read, saved-template SMS/email/WhatsApp, note save, active-task completion, next-task creation, current-opportunity update, contact-status update, and Cyber closed-lost sequence setup.

Every browser action is only available after its matching proposal is marked **approved**. The worker captures a screenshot in `/opt/c2c-assistant/files/screenshots`, persists the result against the proposal, and writes an audit event. If a selector, expected page state, or saved template cannot be confirmed, the execution ends as blocked with the reason recorded; it must never create a substitute action.

### Genie connection checklist — no API key

| Order | VPS action | Expected result |
| --- | --- | --- |
| 1 | Set `GENIE_LOGIN_URL`, `GENIE_USERNAME`, `GENIE_PASSWORD`, `BROWSERLESS_TOKEN`, and the `GENIE_*_SELECTOR` values in `.env`. | The browser service has authorised login details; no API key is created or stored. |
| 2 | Run the worker health check command above. | The worker reaches the Genie login page, signs in, and confirms the configured dashboard selector. |
| 3 | Replace every `REPLACE_*` selector in `config/genie-scripts.json` with selectors reviewed against the real authorised Genie screen. | Read and write scripts target the actual CRM controls rather than placeholders. |
| 4 | Test read-only scripts first: candidate search and history read. | The Sales Operations Hub can show a compact, cached CRM context without changing Genie. |
| 5 | Test one proposed write at a time in a non-critical record: note save, task creation, active-task completion, current-opportunity update, contact-status update, and saved templates. | Each execution produces a captured screenshot and a retained audit result. |
| 6 | Enable normal review queues only after each required script has passed. | The assistant may prepare work, but only a user-approved proposal can operate Genie. |

> If Genie changes its layout, template names, or permissions, pause affected scripts, retain the failure evidence, recalibrate only the relevant selector, and retest the script before re-enabling it. The assistant must block rather than guess at a CRM action.

## 5. Ongoing operations and updates

Use the following commands for visibility and a safe source update. Always review migrations before applying them to the production database.

```bash
docker compose -f deploy/webdock/docker-compose.yml --env-file .env ps
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs -f app
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs -f worker

git pull --ff-only
docker compose -f deploy/webdock/docker-compose.yml --env-file .env build
docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --rm app pnpm drizzle-kit migrate
docker compose -f deploy/webdock/docker-compose.yml --env-file .env up -d
```

The worker runs a Genie login and dashboard-selector health check every 12 hours. A failed check exits non-zero and is visible in the worker log; treat that as a reason to pause risky browser scripts, capture the changed UI, update only the affected saved selector, and retest before resuming writes.

## 6. Backup and recovery

Enable Webdock backups and take an application-level MariaDB dump before schema changes.

```bash
mkdir -p backups
docker compose -f deploy/webdock/docker-compose.yml --env-file .env exec -T db \
  mariadb-dump -u root -p"$DB_ROOT_PASSWORD" amarktai_sales_assistant > "backups/db-$(date +%F-%H%M%S).sql"
```

Store backups off-server according to your retention policy and routinely test a restoration on an isolated database.
