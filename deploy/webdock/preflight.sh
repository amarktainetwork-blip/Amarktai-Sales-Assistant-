#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env}"
PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
warn() { printf '%s\n' "WARN: $*" >&2; }
info() { printf '%s\n' "OK: $*"; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE does not exist. Copy deploy/webdock/configuration.template first."
chmod 600 "$ENV_FILE" 2>/dev/null || true

env_get() {
  key="$1"
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || { printf '%s' ""; return 0; }
  value="${line#*=}"
  value="$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

is_placeholder() {
  value="${1:-}"
  [ -z "$value" ] || printf '%s' "$value" | grep -Eqi 'replace_with|example\.com|your-genx-endpoint|your-genie-login-url'
}

required="DOMAIN DB_PASSWORD DB_ROOT_PASSWORD JWT_SECRET SECRET_KEY APP_PUBLIC_URL CONNECTION_SECRETS_MASTER_KEY LOCAL_ADMIN_NAME LOCAL_ADMIN_EMAIL LOCAL_ADMIN_PASSWORD AUTH_MODE VITE_AUTH_MODE GENX_CHAT_COMPLETIONS_URL GENX_API_KEY GENX_DEFAULT_MODEL SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD SMTP_FROM"
for key in $required; do
  value="$(env_get "$key")"
  is_placeholder "$value" && fail "$key is empty or still contains a template value."
done

DOMAIN="$(env_get DOMAIN)"
APP_PUBLIC_URL="$(env_get APP_PUBLIC_URL)"
DB_PASSWORD="$(env_get DB_PASSWORD)"
DB_ROOT_PASSWORD="$(env_get DB_ROOT_PASSWORD)"
CONNECTION_SECRETS_MASTER_KEY="$(env_get CONNECTION_SECRETS_MASTER_KEY)"
LOCAL_ADMIN_EMAIL="$(env_get LOCAL_ADMIN_EMAIL)"
LOCAL_ADMIN_PASSWORD="$(env_get LOCAL_ADMIN_PASSWORD)"
JWT_SECRET="$(env_get JWT_SECRET)"
SECRET_KEY="$(env_get SECRET_KEY)"
AUTH_MODE="$(env_get AUTH_MODE)"
VITE_AUTH_MODE="$(env_get VITE_AUTH_MODE)"
GENX_CHAT_COMPLETIONS_URL="$(env_get GENX_CHAT_COMPLETIONS_URL)"
BROWSERLESS_WS_ENDPOINT="$(env_get BROWSERLESS_WS_ENDPOINT)"
HUBSPOT_CLIENT_ID="$(env_get HUBSPOT_CLIENT_ID)"
HUBSPOT_CLIENT_SECRET="$(env_get HUBSPOT_CLIENT_SECRET)"
GENIE_LOGIN_URL="$(env_get GENIE_LOGIN_URL)"
GENIE_USERNAME="$(env_get GENIE_USERNAME)"
GENIE_PASSWORD="$(env_get GENIE_PASSWORD)"
STT_TRANSCRIPTIONS_URL="$(env_get STT_TRANSCRIPTIONS_URL)"
STT_MODEL="$(env_get STT_MODEL)"
TTS_BASE_URL="$(env_get TTS_BASE_URL)"
SMTP_HOST="$(env_get SMTP_HOST)"
SMTP_PORT="$(env_get SMTP_PORT)"
SMTP_SECURE="$(env_get SMTP_SECURE)"
SMTP_USER="$(env_get SMTP_USER)"
SMTP_PASSWORD="$(env_get SMTP_PASSWORD)"
SMTP_FROM="$(env_get SMTP_FROM)"
OUTLOOK_TENANT_ID="$(env_get OUTLOOK_TENANT_ID)"
OUTLOOK_CLIENT_ID="$(env_get OUTLOOK_CLIENT_ID)"
OUTLOOK_CLIENT_SECRET="$(env_get OUTLOOK_CLIENT_SECRET)"
OUTLOOK_SENDER_EMAIL="$(env_get OUTLOOK_SENDER_EMAIL)"

case "$APP_PUBLIC_URL" in
  https://*) : ;;
  *) fail "APP_PUBLIC_URL must use https:// for a deployed environment." ;;
esac

case "$GENX_CHAT_COMPLETIONS_URL" in
  https://*) : ;;
  *) fail "GENX_CHAT_COMPLETIONS_URL must use https:// in production." ;;
esac

case "$DOMAIN" in
  http://*|https://*|*/*) fail "DOMAIN must be a hostname only, without scheme or path." ;;
esac

[ "$AUTH_MODE" = "local" ] || fail "AUTH_MODE must be local for the self-hosted production release."
[ "$VITE_AUTH_MODE" = "local" ] || fail "VITE_AUTH_MODE must be local for the self-hosted production release."
printf '%s' "$LOCAL_ADMIN_EMAIL" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' || fail "LOCAL_ADMIN_EMAIL must be a valid email address."

KEY_BYTES="$(printf '%s' "$CONNECTION_SECRETS_MASTER_KEY" | base64 -d 2>/dev/null | wc -c | tr -d ' ')" || true
[ "$KEY_BYTES" = "32" ] || fail "CONNECTION_SECRETS_MASTER_KEY must be exactly 32 random bytes encoded as base64."

[ "${#DB_PASSWORD}" -ge 32 ] || fail "DB_PASSWORD must be at least 32 characters."
[ "${#DB_ROOT_PASSWORD}" -ge 32 ] || fail "DB_ROOT_PASSWORD must be at least 32 characters."
[ "$DB_PASSWORD" != "$DB_ROOT_PASSWORD" ] || fail "DB_PASSWORD and DB_ROOT_PASSWORD must be different."
[ "${#LOCAL_ADMIN_PASSWORD}" -ge 16 ] || fail "LOCAL_ADMIN_PASSWORD must be at least 16 characters for deployment."
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET must be at least 32 characters."
[ "${#SECRET_KEY}" -ge 32 ] || fail "SECRET_KEY must be at least 32 characters."

case "$SMTP_PORT" in *[!0-9]*|'') fail "SMTP_PORT must be a numeric TCP port." ;; esac
[ "$SMTP_PORT" -ge 1 ] && [ "$SMTP_PORT" -le 65535 ] || fail "SMTP_PORT must be between 1 and 65535."
[ "$SMTP_SECURE" = "true" ] || [ "$SMTP_SECURE" = "false" ] || fail "SMTP_SECURE must be true or false."
[ -n "$SMTP_HOST" ] && [ -n "$SMTP_USER" ] && [ -n "$SMTP_PASSWORD" ] && [ -n "$SMTP_FROM" ] || fail "SMTP is mandatory for production 2FA, recovery, invitations and reports."
info "Mandatory SMTP configuration is present; run the live integration verifier before handover."

if [ "$PROFILE" = "pilot" ]; then
  is_placeholder "$BROWSERLESS_WS_ENDPOINT" && fail "Pilot mode requires BROWSERLESS_WS_ENDPOINT for an external Chromium/CDP service."
  case "$BROWSERLESS_WS_ENDPOINT" in http://*|https://*|ws://*|wss://*) : ;; *) fail "BROWSERLESS_WS_ENDPOINT must be an HTTP(S) or WS(S) endpoint." ;; esac
  info "Pilot profile will use the configured external Chromium/CDP endpoint."
elif [ "$PROFILE" = "full" ]; then
  info "Full profile will build the repository's internal Chromium/CDP runtime."
else
  fail "AMARKTAI_DEPLOY_PROFILE must be 'pilot' or 'full'."
fi

if is_placeholder "$HUBSPOT_CLIENT_ID" || is_placeholder "$HUBSPOT_CLIENT_SECRET"; then
  warn "HubSpot OAuth is not configured; HubSpot will remain unavailable until both values are supplied."
else
  info "HubSpot OAuth client configuration is present."
fi

if is_placeholder "$GENIE_LOGIN_URL" || is_placeholder "$GENIE_USERNAME" || is_placeholder "$GENIE_PASSWORD"; then
  warn "Genie login configuration is incomplete; Genie live validation will remain unavailable."
else
  info "Genie login configuration is present; authorised domains and selectors still require live calibration."
fi

if is_placeholder "$STT_TRANSCRIPTIONS_URL" || is_placeholder "$STT_MODEL"; then
  fail "Speech-to-text must be configured. The full profile uses the internal whisper.cpp service by default."
else
  info "Live Call Companion STT configuration is present; the verifier will run an actual audio fixture."
fi

if is_placeholder "$TTS_BASE_URL"; then
  fail "Text-to-speech must be configured. The full profile uses the internal Piper service by default."
else
  info "Text-to-speech configuration is present; the verifier will require a playable audio artifact."
fi

if is_placeholder "$OUTLOOK_TENANT_ID" || is_placeholder "$OUTLOOK_CLIENT_ID" || is_placeholder "$OUTLOOK_CLIENT_SECRET" || is_placeholder "$OUTLOOK_SENDER_EMAIL"; then
  warn "Microsoft Graph mail/calendar is not configured; review-first Outlook actions will remain unavailable."
else
  info "Microsoft Graph configuration is present; run an authorised provider verification before enabling production mail/calendar actions."
fi

info "Mandatory GenX configuration is present; run the live model/inference verifier before handover."
info "Deployment preflight passed for profile '$PROFILE'."
