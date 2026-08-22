#!/usr/bin/env sh
set -eu

ROOT_DIR="${AMARKTAI_ROOT:-/opt/amarktai-sales-assistant}"
COMPOSE_FILE="$ROOT_DIR/deploy/webdock/docker-compose.yml"
required_keys="DOMAIN DB_PASSWORD DB_ROOT_PASSWORD BROWSERLESS_TOKEN INTERNAL_SCHEDULER_TOKEN JWT_SECRET SECRET_KEY AUTH_MODE VITE_AUTH_MODE LOCAL_ADMIN_NAME LOCAL_ADMIN_EMAIL LOCAL_ADMIN_PASSWORD SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this installer as the non-root Webdock sudo user." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the Compose plugin is required before installation." >&2
  exit 1
fi
if [ ! -d "$ROOT_DIR" ]; then
  echo "Expected repository checkout at $ROOT_DIR. Clone the GitHub repository there before installation." >&2
  exit 1
fi

cd "$ROOT_DIR"
if [ ! -f .env ]; then
  cp deploy/webdock/configuration.template .env
  chmod 600 .env
  echo "Created .env. Fill every required value, then run this installer again." >&2
  exit 1
fi

for key in $required_keys; do
  value="$(sed -n "s/^${key}=//p" .env | tail -n 1)"
  if [ -z "$value" ] || printf '%s' "$value" | grep -Eqi 'replace_with|your-|changeme|placeholder|^example\.com$'; then
    echo "Required .env value $key is missing or still a placeholder." >&2
    exit 1
  fi
done

if ! grep -qx 'AUTH_MODE=local' .env || ! grep -qx 'VITE_AUTH_MODE=local' .env; then
  echo "AUTH_MODE and VITE_AUTH_MODE must both be local." >&2
  exit 1
fi

mkdir -p config files/screenshots backups
if [ ! -f config/genie-scripts.json ]; then
  cp deploy/webdock/genie-scripts.template.json config/genie-scripts.json
  echo "Created config/genie-scripts.json. Calibrate only in an authorised Genie session before requesting CRM verification."
fi

corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
docker compose -f "$COMPOSE_FILE" --env-file .env config -q
docker compose -f "$COMPOSE_FILE" --env-file .env build
docker compose -f "$COMPOSE_FILE" --env-file .env up -d db browser
for attempt in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" --env-file .env exec -T db healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 30 ]; then echo "MariaDB did not become healthy." >&2; exit 1; fi
  sleep 2
done
docker compose -f "$COMPOSE_FILE" --env-file .env run --rm --no-deps app pnpm drizzle-kit migrate
docker compose -f "$COMPOSE_FILE" --env-file .env up -d app worker caddy
for attempt in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app curl -fsS http://localhost:3000/healthz >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 30 ]; then echo "Application liveness endpoint did not become available." >&2; exit 1; fi
  sleep 2
done
./deploy/webdock/verify-production.sh
