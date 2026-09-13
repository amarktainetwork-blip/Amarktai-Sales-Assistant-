#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }

AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/preflight.sh .env
AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/backup.sh

COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"
VCS_REF="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
$COMPOSE config >/dev/null
$COMPOSE build --build-arg VCS_REF="$VCS_REF"
$COMPOSE run --rm app node dist/migrate.js
$COMPOSE up -d --remove-orphans
AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/smoke-test.sh

printf 'Update completed for %s profile.\n' "$PROFILE"
