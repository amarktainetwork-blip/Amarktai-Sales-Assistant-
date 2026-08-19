#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env}"
PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
warn() { printf '%s\n' "WARN: $*" >&2; }
info() { printf '%s\n' "OK: $*"; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE does not exist. Copy deploy/webdock/configuration.template first."
chmod 600 "$ENV_FILE" 2>/dev/null || true

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

is_placeholder() {
  value="${1:-}"
  [ -z "$value" ] || printf '%s' "$value" | grep -Eqi 'replace_with|example\.com|your-genx-endpoint|your-genie-login-url'
}

required="DOMAIN DB_PASSWORD DB_ROOT_PASSWORD JWT_SECRET SECRET_KEY APP_PUBLIC_URL CONNECTION_SECRETS_MASTER_KEY LOCAL_ADMIN_EMAIL LOCAL_ADMIN_PASSWORD GENX_CHAT_COMPLETIONS_URL GENX_API_KEY GENX_DEFAULT_MODEL"
for key in $required; do
  eval "value=\${$key:-}"
  is_placeholder "$value" && fail "$key is empty or still contains a template value."
done

case "$APP_PUBLIC_URL" in
  https://*) : ;;
  *) fail "APP_PUBLIC_URL must use https:// for a deployed environment." ;;
esac

case "$DOMAIN" in
  http://*|https://*|*/*) fail "DOMAIN must be a hostname only, without scheme or path." ;;
esac

KEY_BYTES="$(printf '%s' "$CONNECTION_SECRETS_MASTER_KEY" | base64 -d 2>/dev/null | wc -c | tr -d ' ')" || true
[ "$KEY_BYTES" = "32" ] || fail "CONNECTION_SECRETS_MASTER_KEY must be exactly 32 random bytes encoded as base64."

[ "${#LOCAL_ADMIN_PASSWORD}" -ge 16 ] || fail "LOCAL_ADMIN_PASSWORD must be at least 16 characters for deployment."
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET must be at least 32 characters."
[ "${#SECRET_KEY}" -ge 32 ] || fail "SECRET_KEY must be at least 32 characters."

if [ "$PROFILE" = "pilot" ]; then
  is_placeholder "${BROWSERLESS_WS_ENDPOINT:-}" && fail "Pilot mode requires BROWSERLESS_WS_ENDPOINT for an external Chromium/CDP service."
  info "Pilot profile will use the configured external Chromium/CDP endpoint."
elif [ "$PROFILE" = "full" ]; then
  info "Full profile will build the repository's internal Chromium/CDP runtime."
else
  fail "AMARKTAI_DEPLOY_PROFILE must be 'pilot' or 'full'."
fi

if is_placeholder "${HUBSPOT_CLIENT_ID:-}" || is_placeholder "${HUBSPOT_CLIENT_SECRET:-}"; then
  warn "HubSpot OAuth is not configured; HubSpot will remain unavailable until both values are supplied."
else
  info "HubSpot OAuth client configuration is present."
fi

if is_placeholder "${GENIE_LOGIN_URL:-}" || is_placeholder "${GENIE_USERNAME:-}" || is_placeholder "${GENIE_PASSWORD:-}"; then
  warn "Genie login configuration is incomplete; Genie live validation will remain unavailable."
else
  info "Genie login configuration is present; selectors still require authorised calibration."
fi

if is_placeholder "${STT_TRANSCRIPTIONS_URL:-}" || is_placeholder "${STT_MODEL:-}"; then
  warn "Speech-to-text is not configured; Live Call Companion will remain unavailable until STT_TRANSCRIPTIONS_URL and STT_MODEL are supplied."
else
  info "Live Call Companion speech-to-text configuration is present."
fi

if is_placeholder "${SMTP_HOST:-}" || is_placeholder "${SMTP_USER:-}" || is_placeholder "${SMTP_PASSWORD:-}"; then
  warn "SMTP is not configured; email 2FA and email reports cannot be activated."
else
  info "SMTP configuration is present."
fi

info "Deployment preflight passed for profile '$PROFILE'."
