#!/usr/bin/env sh
set -eu

[ "$#" -ge 1 ] || { echo "Usage: AMARKTAI_CONFIRM_RESTORE=YES $0 <database.sql.gz> [connector-files.tar.gz]" >&2; exit 2; }
[ "${AMARKTAI_CONFIRM_RESTORE:-}" = "YES" ] || { echo "Restore is destructive. Set AMARKTAI_CONFIRM_RESTORE=YES explicitly." >&2; exit 2; }
[ -f .env ] || { echo ".env is missing." >&2; exit 1; }

SQL_BACKUP="$1"
FILES_BACKUP="${2:-}"
[ -f "$SQL_BACKUP" ] || { echo "Database backup not found: $SQL_BACKUP" >&2; exit 1; }
[ -z "$FILES_BACKUP" ] || [ -f "$FILES_BACKUP" ] || { echo "Connector-file archive not found: $FILES_BACKUP" >&2; exit 1; }

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }
COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"

verify_checksum() {
  file="$1"
  if [ -f "$file.sha256" ]; then
    (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256")
  else
    echo "WARNING: no checksum file found for $file" >&2
  fi
}
verify_checksum "$SQL_BACKUP"
[ -z "$FILES_BACKUP" ] || verify_checksum "$FILES_BACKUP"
gzip -t "$SQL_BACKUP"

if [ -n "$FILES_BACKUP" ]; then
  # Archives created by backup.sh may contain only these relative trees.
  tar -tzf "$FILES_BACKUP" | grep -Ev '^(config|files/connector-evidence)(/|$)' > /tmp/amarktai-restore-invalid.$$ || true
  if [ -s /tmp/amarktai-restore-invalid.$$ ]; then
    echo "Connector archive contains an unexpected path; restore refused." >&2
    cat /tmp/amarktai-restore-invalid.$$ >&2
    rm -f /tmp/amarktai-restore-invalid.$$
    exit 1
  fi
  rm -f /tmp/amarktai-restore-invalid.$$
fi

# Keep database/cache available while application processes are stopped.
$COMPOSE stop caddy app worker reporter 2>/dev/null || true
$COMPOSE up -d db redis

# Replace the application database from the explicitly selected backup.
$COMPOSE exec -T db sh -eu -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS amarktai_sales_assistant; CREATE DATABASE amarktai_sales_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON amarktai_sales_assistant.* TO '\''amarktai'\''@'\''%'\''; FLUSH PRIVILEGES;"'
gunzip -c "$SQL_BACKUP" | $COMPOSE exec -T db sh -eu -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" amarktai_sales_assistant'

if [ -n "$FILES_BACKUP" ]; then
  mkdir -p deploy/webdock/config deploy/webdock/files/connector-evidence
  tar -xzf "$FILES_BACKUP" -C deploy/webdock
fi

$COMPOSE up -d --remove-orphans
AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/smoke-test.sh
printf 'RESTORE=PASS\nDatabase=%s\nProfile=%s\n' "$SQL_BACKUP" "$PROFILE"
