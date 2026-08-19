#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }
[ -f .env ] || { echo ".env is missing" >&2; exit 1; }

mkdir -p deploy/webdock/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="deploy/webdock/backups/amarktai-${STAMP}.sql.gz"
COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"

$COMPOSE exec -T db sh -eu -c 'mariadb-dump --single-transaction --quick --routines --events -uroot -p"$MARIADB_ROOT_PASSWORD" amarktai_sales_assistant' | gzip -9 > "$DEST"
test -s "$DEST" || { rm -f "$DEST"; echo "Backup was empty; removed it." >&2; exit 1; }
sha256sum "$DEST" > "$DEST.sha256"
printf 'Backup created: %s\n' "$DEST"
