#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
ENV_FILE=".env"
TEMPLATE="deploy/webdock/configuration.template"

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

[ "$(id -u)" -ne 0 ] || fail "Run this installer as a non-root sudo user."
command -v openssl >/dev/null 2>&1 || fail "openssl is required."
command -v docker >/dev/null 2>&1 || fail "Docker is required. Install Docker Engine and the Docker Compose plugin first."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required."
[ -f "$TEMPLATE" ] || fail "Run this script from the repository root."
[ "$PROFILE" = "full" ] || [ "$PROFILE" = "pilot" ] || fail "AMARKTAI_DEPLOY_PROFILE must be 'full' or 'pilot'."

prompt() {
  label="$1"
  default="${2:-}"
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$label" "$default" >&2
  else
    printf '%s: ' "$label" >&2
  fi
  IFS= read -r answer
  [ -n "$answer" ] || answer="$default"
  printf '%s' "$answer"
}

prompt_required() {
  label="$1"
  default="${2:-}"
  while :; do
    answer="$(prompt "$label" "$default")"
    [ -n "$answer" ] && { printf '%s' "$answer"; return 0; }
    printf 'A value is required.\n' >&2
  done
}

prompt_secret() {
  label="$1"
  while :; do
    printf '%s: ' "$label" >&2
    stty -echo 2>/dev/null || true
    IFS= read -r answer
    stty echo 2>/dev/null || true
    printf '\n' >&2
    [ -n "$answer" ] && { printf '%s' "$answer"; return 0; }
    printf 'A value is required.\n' >&2
  done
}

set_env() {
  key="$1"
  value="$2"
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

if [ -f "$ENV_FILE" ]; then
  printf '%s\n' "An existing .env was found. This guided setup will update core deployment values and preserve optional values." >&2
else
  cp "$TEMPLATE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

info ""
info "Amarktai Sales Assistant — guided Webdock setup"
info "Profile: $PROFILE"
info "Internal database/application secrets will be generated automatically."
info "You only need the client/domain, SMTP and GenX values below."
info ""

DOMAIN="$(prompt_required "Public hostname (no https://)")"
ADMIN_NAME="$(prompt_required "Administrator name" "Amarktai Administrator")"
ADMIN_EMAIL="$(prompt_required "Administrator email")"
ADMIN_PASSWORD="$(prompt_secret "Administrator password (16+ characters)")"

GENX_URL="$(prompt_required "GenX chat-completions URL")"
GENX_KEY="$(prompt_secret "GenX API key")"
GENX_MODEL="$(prompt_required "GenX default model ID")"

SMTP_HOST="$(prompt_required "SMTP host")"
SMTP_PORT="$(prompt_required "SMTP port" "587")"
SMTP_SECURE="$(prompt_required "SMTP secure: true for implicit TLS, false for STARTTLS/plain" "false")"
SMTP_USER="$(prompt_required "SMTP username")"
SMTP_PASSWORD="$(prompt_secret "SMTP password")"
SMTP_FROM="$(prompt_required "SMTP From value" "Amarktai Sales Assistant <$ADMIN_EMAIL>")"

if [ "${#ADMIN_PASSWORD}" -lt 16 ]; then
  fail "Administrator password must be at least 16 characters."
fi

DB_PASSWORD="$(openssl rand -hex 24)"
DB_ROOT_PASSWORD="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 32)"
SECRET_KEY="$(openssl rand -hex 32)"
CONNECTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"

set_env DOMAIN "$DOMAIN"
set_env APP_PUBLIC_URL "https://$DOMAIN"
set_env DB_PASSWORD "$DB_PASSWORD"
set_env DB_ROOT_PASSWORD "$DB_ROOT_PASSWORD"
set_env JWT_SECRET "$JWT_SECRET"
set_env SECRET_KEY "$SECRET_KEY"
set_env CONNECTION_SECRETS_MASTER_KEY "$CONNECTION_KEY"
set_env CONNECTION_SECRETS_KEY_VERSION "v1"
set_env AUTH_MODE "local"
set_env VITE_AUTH_MODE "local"
set_env LOCAL_ADMIN_NAME "$ADMIN_NAME"
set_env LOCAL_ADMIN_EMAIL "$ADMIN_EMAIL"
set_env LOCAL_ADMIN_PASSWORD "$ADMIN_PASSWORD"
set_env GENX_CHAT_COMPLETIONS_URL "$GENX_URL"
set_env GENX_API_KEY "$GENX_KEY"
set_env GENX_DEFAULT_MODEL "$GENX_MODEL"
set_env SMTP_HOST "$SMTP_HOST"
set_env SMTP_PORT "$SMTP_PORT"
set_env SMTP_SECURE "$SMTP_SECURE"
set_env SMTP_USER "$SMTP_USER"
set_env SMTP_PASSWORD "$SMTP_PASSWORD"
set_env SMTP_FROM "$SMTP_FROM"

if [ "$PROFILE" = "pilot" ]; then
  CDP_ENDPOINT="$(prompt_required "External authorised Playwright/CDP endpoint for pilot profile")"
  set_env BROWSERLESS_WS_ENDPOINT "$CDP_ENDPOINT"
fi

info ""
info "Core .env configuration written with mode 0600."
info "Optional CRM, Outlook, STT, SMS and WhatsApp credentials can be added after the core install."
info "Running production preflight and installer now..."
info ""

AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/preflight.sh "$ENV_FILE"
AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/install.sh

info ""
info "Core installation completed."
info "Next: point/confirm DNS for $DOMAIN, then run:"
info "VERIFY_PUBLIC_URL=https://$DOMAIN AMARKTAI_DEPLOY_PROFILE=$PROFILE sh deploy/webdock/verify-production.sh"
