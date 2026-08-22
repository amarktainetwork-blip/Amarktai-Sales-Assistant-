# Webdock VPS Installation Runbook

This repository is designed to run **self-hosted** on a Webdock Ubuntu VPS. The deployment contains Caddy, the Amarktai application, a separate internal worker, MariaDB 11.7, and Browserless Chromium. The application uses local email-and-password authentication followed by SMTP-delivered six-digit verification. It has **no production dependency on Manus, Forge, hosted scheduling, a Genie API key, or a preview session**.

> **Safety boundary.** The assistant can prepare and route work, but no CRM, email, SMS, WhatsApp, calendar, or other external action may run until a person approves its proposal and a current, server-verified compatible CRM route exists.

## 1. Prepare the VPS

Use an Ubuntu 24.04 VPS capable of running MariaDB and a Chromium browser service. Create a non-root administrator, use SSH keys, and expose only SSH, HTTP, and HTTPS. Follow Docker’s current Ubuntu installation documentation to install Docker Engine and the Compose plugin.

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo adduser --disabled-password --gecos "" amarktai
sudo usermod -aG sudo amarktai
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

docker --version
docker compose version
```

## 2. Clone the release and create the install-time environment

The installation path is fixed at `/opt/amarktai-sales-assistant`. Real credentials are entered only into `.env` on the VPS. Never commit this file or send its contents in chat.

```bash
sudo mkdir -p /opt/amarktai-sales-assistant
sudo chown amarktai:amarktai /opt/amarktai-sales-assistant
git clone https://github.com/amarktainetwork-blip/Amarktai-Network-V2.git /opt/amarktai-sales-assistant
cd /opt/amarktai-sales-assistant
cp deploy/webdock/configuration.template .env
chmod 600 .env
nano .env
```

| Configuration group | Installation requirement | Operational effect |
| --- | --- | --- |
| Domain, database, application, browser, scheduler secrets | **Required** and must not retain template placeholders. | The stack cannot install without them. |
| `AUTH_MODE=local`, `VITE_AUTH_MODE=local`, local administrator details | **Required.** Use a 16+ character unique administrator password. | Enables host-only, HTTP-only local sessions. |
| SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) | **Required.** `SMTP_FROM` can use `Name <mailbox@domain>`. | Enables six-digit second-factor delivery and daily reports. |
| GenX endpoint/key/model | Optional. | The intelligence service remains **Not Ready** until the models probe and minimal request pass. |
| Genie browser credentials/selectors | Optional. There is **no Genie API key**. | CRM execution remains unavailable until server verification and authorised selector calibration pass. |
| Outlook tenant/client/secret/sender | Optional. | The connection is only configuration-ready; no Outlook write action should be claimed live until separately implemented and validated. |

## 3. DNS, TLS, installation, and acceptance gate

Create a public A or AAAA DNS record for the configured `DOMAIN` before installation. Caddy requests and renews the TLS certificate after DNS resolves. The installer validates required `.env` keys and placeholder values, builds the actual Compose services, waits for MariaDB, runs migrations, starts the application/worker/proxy, and executes acceptance verification.

```bash
cd /opt/amarktai-sales-assistant
chmod +x deploy/webdock/*.sh scripts/*.sh
./deploy/webdock/install.sh
```

The installer intentionally fails rather than continuing when a mandatory secret is empty, a template placeholder remains, local auth mode is not selected, MariaDB is unhealthy, a migration fails, the application health endpoint is unavailable, or the mandatory SMTP verification probe fails.

After public DNS and TLS are working, repeat public-header verification explicitly:

```bash
cd /opt/amarktai-sales-assistant
VERIFY_PUBLIC_URL="https://assistant.example.co.za" ./deploy/webdock/verify-production.sh
```

The public check confirms the health endpoint and Caddy’s security headers, including HSTS, CSP, `nosniff`, frame denial, and browser-permission minimisation. It does **not** claim that an optional external CRM or intelligence service has been authorised unless its corresponding probe passes.

## 4. Local login and administrator recovery

Sign in with `LOCAL_ADMIN_EMAIL` and `LOCAL_ADMIN_PASSWORD`, request the six-digit email code, and confirm the dashboard opens. The development preview route is not available in the production container.

To send one explicit SMTP-format two-factor test message to the configured administrator before attempting the browser sign-in, run the following command manually. It is never invoked by the installer or worker.

```bash
cd /opt/amarktai-sales-assistant
docker compose -f deploy/webdock/docker-compose.yml --env-file .env exec -T app pnpm smtp:test-2fa
```

If access must be recovered, edit `.env`, take a backup, remove only the intended local user after reviewing the query, restart the application, then complete a real password-plus-email-code sign-in. The following example removes all local users and should only be used on a single-administrator installation:

```bash
cd /opt/amarktai-sales-assistant
./deploy/webdock/backup.sh
nano .env

set -a
. ./.env
set +a
MYSQL_PWD="$DB_ROOT_PASSWORD" docker compose -f deploy/webdock/docker-compose.yml --env-file .env \
  exec -T db mariadb -uroot amarktai_sales_assistant \
  -e "DELETE FROM users WHERE openId LIKE 'local:%';"

docker compose -f deploy/webdock/docker-compose.yml --env-file .env up -d app
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs --tail=100 app
```

The next successful login creates the configured local administrator again. For multiple users, replace the broad delete with a reviewed email-specific operation.

## 5. Self-hosted worker and scheduler

The `worker` service calls an internal authenticated scheduler route every minute. The route evaluates six-field UTC cron schedules in MariaDB, claims each daily delivery atomically, and releases a failed claim so a later run may retry. No hosted scheduler or owner-notification service is used.

```bash
cd /opt/amarktai-sales-assistant
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs -f worker
docker compose -f deploy/webdock/docker-compose.yml --env-file .env logs -f app
```

The worker also attempts a Genie login/dashboard health check at 00:00 and 12:00 UTC. An unconfigured Genie bridge is not a successful CRM verification. Do not treat worker startup as evidence that CRM writes are enabled.

## 6. Genie CRM commissioning — browser bridge, no API key

Set the Genie login URL, credentials, Browserless token, and reviewed selectors in `.env`. The browser service is internal-only. In Company Setup, register the intended CRM capabilities and select **Verify on server**. The server records either a fresh evidence-backed result with a 12-hour expiry or a truthful failure state.

```bash
cd /opt/amarktai-sales-assistant
docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --rm worker /app/scripts/run-genie-health-check.sh
nano config/genie-scripts.json
```

Calibrate the selector file only against an authorised Genie account. Start with read-only candidate search and history checks. Then test a single approved write on a non-critical record at a time. Every operation must retain its proposal, result, audit event, and any available evidence. A stale, failed, unimplemented, or capability-mismatched CRM route blocks execution.

## 7. Daily operations, backups, updates, and rollback

Use the scripted commands rather than editing containers directly. All commands preserve the VPS `.env` and database volume; do not use destructive Docker volume commands during normal operations.

```bash
cd /opt/amarktai-sales-assistant

# View runtime status and run acceptance checks.
docker compose -f deploy/webdock/docker-compose.yml --env-file .env ps
./deploy/webdock/verify-production.sh

# Create a database and protected configuration backup.
./deploy/webdock/backup.sh

# Back up, fast-forward main, rebuild, migrate, restart, and verify.
./deploy/webdock/upgrade.sh

# Back up and reinstall a known-good Git SHA or release tag.
./deploy/webdock/rollback.sh <known-good-git-sha-or-tag>
```

Store generated backups outside the VPS according to the organisation’s retention policy, and practise restoration into an isolated environment. The rollback command restores application code but cannot automatically reverse a database migration; review migrations before every upgrade and restore the appropriate database backup when a schema rollback is required.

## 8. What local verification does and does not prove

The release gates can validate static configuration, shell syntax, TypeScript, tests, builds, local artifact health, migrations on a real target database, SMTP transport, configured GenX model/minimal-request reachability, and authorised Genie login when those credentials are supplied on the VPS. They cannot prove DNS ownership, Caddy certificate issuance, an actual mailbox receiving a code, external provider permissions, browser-selector calibration, or deliberate CRM/Outlook writes until an operator performs those authorised live checks.
