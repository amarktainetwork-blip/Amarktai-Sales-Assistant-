# Webdock VPS Installation and Client Commissioning

This release deploys Amarktai Sales Assistant with React/Vite + Express/tRPC, MariaDB, Valkey, Caddy and either internal or external Chromium/CDP. GenX is the mandatory AI boundary; SMTP is mandatory for protected-account access. CRM/provider readiness is verified separately and fails closed.

## 1. Host

Use Ubuntu 24.04, a non-root sudo user, SSH keys, Docker Engine and the Docker Compose plugin. Expose only SSH, HTTP and HTTPS. For the full profile, size CPU/RAM from measured CRM-browser concurrency.

```bash
docker --version
docker compose version
```

## 2. Clone the canonical repository

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

Generate `CONNECTION_SECRETS_MASTER_KEY` with `openssl rand -base64 32`. Keep it separately protected; losing it prevents encrypted connection credentials from being decrypted. Never commit `.env`.

## 3. Core configuration

The deployment preflight requires strong DB/application secrets, local auth, SMTP and GenX. SMTP is required for email second factor and recovery. GenX is required for the Sales Assistant.

Native OAuth CRM app credentials are optional until that CRM is selected. All native apps use this callback:

```text
https://YOUR_DOMAIN/api/crm/oauth/callback
```

Supported native OAuth adapters: **HubSpot, Salesforce, Pipedrive and Zoho CRM**.

**Genie** and **Other CRM** use the deterministic browser connector. Every browser CRM must have an authorised hostname/path and a calibrated reviewed profile before it is marked ready.

Microsoft 365 / Outlook is optional. Configure `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET` and `OUTLOOK_SENDER_EMAIL`; `OUTBOUND_EMAIL_PROVIDER=auto` prefers Outlook for reviewed outbound sales email once configured. Approved calendar actions use Microsoft Graph.

## 4. Install

Full self-hosted Chromium:

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/install.sh
```

Pilot/external authorised CDP:

```bash
AMARKTAI_DEPLOY_PROFILE=pilot sh deploy/webdock/install.sh
```

The installer runs preflight, validates Compose, builds images, starts DB/cache/browser infrastructure, applies versioned migrations through `node dist/migrate.js`, then starts the application and workers.

## 5. DNS/TLS and core verification

Point `DOMAIN` to the VPS. Caddy obtains/renews TLS automatically.

```bash
curl -fsS "https://$DOMAIN/healthz"
curl -fsS "https://$DOMAIN/readyz"
```

Then run the full production verifier:

```bash
VERIFY_PUBLIC_URL="https://$DOMAIN" \
AMARKTAI_DEPLOY_PROFILE=full \
sh deploy/webdock/verify-production.sh
```

Do not hand over the client installation until this reports `PRODUCTION_VERIFIER=PASS`.

## 6. CRM onboarding acceptance

From the protected UI:

1. Complete Company Setup and confirm company knowledge.
2. Open Connections.
3. Choose HubSpot, Salesforce, Pipedrive or Zoho for native OAuth; or Genie/Other CRM for an authorised browser connector.
4. Complete OAuth or save encrypted browser credentials/profile.
5. Run **Test connection**.
6. Confirm requested capabilities become backend-verified.
7. Run **Sync now**.
8. Confirm owner/salesperson mappings where required.
9. Execute one authorised read and one safe reviewed write.
10. Confirm execution evidence/audit and the external CRM result.

A connection with missing scopes, selectors or credentials remains limited/needs-attention instead of being treated as live.

## 7. Genie / Other CRM

The installer creates `deploy/webdock/config/genie-scripts.json` from the generic template when absent. Replace every `REPLACE_*` selector used by the target Genie environment before writes are enabled. Other browser CRMs use an organisation-specific reviewed browser profile entered under Connections.

Browser navigation is restricted to the connection's authorised domain/path and private/local network destinations are blocked. Evidence is retained under `deploy/webdock/files/connector-evidence/`.

## 8. Outlook

After Graph credentials are entered, the integration verifier obtains a real Microsoft token. Commission with a controlled test mailbox/account, then verify one reviewed email and one reviewed calendar event. Do not call Outlook live merely because the four environment fields are populated.

## 9. Live Call Companion

Configure an authorised OpenAI-compatible STT service:

```text
STT_TRANSCRIPTIONS_URL=https://your-stt-host/v1/audio/transcriptions
STT_MODEL=your-model-id
STT_API_KEY=optional-provider-key
```

The `/calls` workflow requires explicit browser media permission and confirmation that the organisation's recording/transcription consent requirements have been handled. Complete a real audio acceptance before calling STT live-ready.

## 10. SMS and WhatsApp

A verified CRM/browser connector may supply native channel actions. Otherwise configure the generic `SMS_WEBHOOK_URL` / `WHATSAPP_WEBHOOK_URL` bridges. Each bridge must honour Amarktai's `Idempotency-Key`. Commission with a non-critical destination before enabling client use.

## 11. Updates

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/update.sh
```

The guarded update path runs preflight, takes a backup, rebuilds, applies runtime migrations, restarts and smoke-tests.

## 12. Backup

```bash
AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/backup.sh
```

The backup writes:

- compressed MariaDB dump + SHA-256;
- connector calibration/evidence archive + SHA-256;
- manifest with profile and git SHA.

`.env` and raw deployment secrets are deliberately excluded. Keep encrypted off-VPS copies and protect the connection-secret master key separately.

## 13. Restore

Restore is destructive and requires explicit confirmation:

```bash
AMARKTAI_CONFIRM_RESTORE=YES \
AMARKTAI_DEPLOY_PROFILE=full \
sh deploy/webdock/restore.sh \
  deploy/webdock/backups/amarktai-YYYYMMDDTHHMMSSZ.sql.gz \
  deploy/webdock/backups/amarktai-YYYYMMDDTHHMMSSZ-connector-files.tar.gz
```

The restore validates checksums/archive paths, stops application processes, recreates/imports MariaDB, restores connector files when supplied, starts the stack and runs smoke tests.

## 14. Release rollback

A schema rollback must restore the **pre-update database backup** that belongs with the previous verified application SHA. Do not run older code against a newer migrated database and hope migrations reverse themselves.

Safe procedure:

1. record current SHA/logs;
2. identify the previous verified SHA and matching pre-update backup;
3. stop public/app workers;
4. check out the previous verified SHA;
5. rebuild the selected Compose profile;
6. run `restore.sh` with that pre-update backup;
7. run `smoke-test.sh` and `verify-production.sh`;
8. only then restore public access.

## 15. Client handover acceptance

Minimum handover proof:

- public HTTPS and required security headers;
- local registration/login/password recovery and real SMTP second factor;
- company profile + website discovery + confirmed knowledge;
- real GenX response using confirmed company context;
- selected CRM authenticated, verified and synced;
- one authorised CRM read and one safe approved external write;
- audit/evidence visible;
- management/report email delivered;
- backup created and checksum verified.

Optional Outlook/STT/SMS/WhatsApp require their own authorised acceptance before they are labelled live.
