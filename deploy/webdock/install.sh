#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this installer as a non-root sudo user." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Follow docs/webdock-vps-install.md before running this installer." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp deploy/webdock/configuration.template .env
  chmod 600 .env
  echo "Created .env from deploy/webdock/configuration.template. For the easiest setup run: AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/quick-install.sh" >&2
  echo "Or fill every required value in .env and rerun this installer." >&2
  exit 1
fi

chmod 600 .env
PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
if [ "$PROFILE" = "pilot" ]; then
  COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
fi

AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/preflight.sh .env

# Compose bind-mount paths are relative to deploy/webdock, not the repository root.
mkdir -p deploy/webdock/config deploy/webdock/files/connector-evidence deploy/webdock/backups
if [ ! -f deploy/webdock/config/genie-scripts.json ]; then
  cp deploy/webdock/genie-scripts.template.json deploy/webdock/config/genie-scripts.json
  chmod 600 deploy/webdock/config/genie-scripts.json
  echo "Created deploy/webdock/config/genie-scripts.json. Calibrate every REPLACE_* selector before enabling Genie writes." >&2
fi

COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"
$COMPOSE config >/dev/null
$COMPOSE build
$COMPOSE up -d db redis
if [ "$PROFILE" = "full" ]; then
  $COMPOSE up -d browser
fi
$COMPOSE run --rm app node dist/migrate.js
$COMPOSE up -d
$COMPOSE ps

SMOKE_LOG="$(mktemp)"
trap 'rm -f "$SMOKE_LOG"' EXIT INT TERM
attempt=1
while [ "$attempt" -le 30 ]; do
  if AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/smoke-test.sh >"$SMOKE_LOG" 2>&1; then
    cat "$SMOKE_LOG"
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Deployment started but the internal smoke test did not become healthy." >&2
    cat "$SMOKE_LOG" >&2
    echo "Inspect with: $COMPOSE ps && $COMPOSE logs --tail=200 app" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

DOMAIN="$(grep '^DOMAIN=' .env | tail -1 | cut -d= -f2-)"
printf '\nAmarktai deployment is internally healthy using profile: %s\n' "$PROFILE"
printf 'Health check: https://%s/healthz\n' "$DOMAIN"
printf 'Readiness check: https://%s/readyz\n' "$DOMAIN"
printf 'After DNS/TLS is active, run: VERIFY_PUBLIC_URL=https://%s AMARKTAI_DEPLOY_PROFILE=%s sh deploy/webdock/verify-production.sh\n' "$DOMAIN" "$PROFILE"
