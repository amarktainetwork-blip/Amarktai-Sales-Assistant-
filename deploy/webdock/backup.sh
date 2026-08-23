#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }
[ -f .env ] || { echo ".env is missing" >&2; exit 1; }

BACKUP_DIR="deploy/webdock/backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SQL_DEST="$BACKUP_DIR/amarktai-${STAMP}.sql.gz"
FILES_DEST="$BACKUP_DIR/amarktai-${STAMP}-connector-files.tar.gz"
MANIFEST="$BACKUP_DIR/amarktai-${STAMP}.manifest.txt"
COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"

$COMPOSE exec -T db sh -eu -c 'mariadb-dump --single-transaction --quick --routines --events -uroot -p"$MARIADB_ROOT_PASSWORD" amarktai_sales_assistant' | gzip -9 > "$SQL_DEST"
test -s "$SQL_DEST" || { rm -f "$SQL_DEST"; echo "Backup was empty; removed it." >&2; exit 1; }

# Connector selectors/profile files and retained evidence live outside MariaDB.
# Deliberately never archive .env, deployment secrets, caddy data or database volumes.
mkdir -p deploy/webdock/config deploy/webdock/files/connector-evidence
if command -v tar >/dev/null 2>&1; then
  tar -czf "$FILES_DEST" -C deploy/webdock config files/connector-evidence
  test -s "$FILES_DEST" || { rm -f "$FILES_DEST"; echo "Connector-file archive was empty." >&2; exit 1; }
fi

sha256sum "$SQL_DEST" > "$SQL_DEST.sha256"
if [ -f "$FILES_DEST" ]; then sha256sum "$FILES_DEST" > "$FILES_DEST.sha256"; fi
{
  printf 'created_utc=%s\n' "$STAMP"
  printf 'profile=%s\n' "$PROFILE"
  printf 'git_commit=%s\n' "$(git rev-parse HEAD 2>/dev/null || printf unknown)"
  printf 'database=%s\n' "$SQL_DEST"
  [ ! -f "$FILES_DEST" ] || printf 'connector_files=%s\n' "$FILES_DEST"
  printf 'secrets_included=NO\n'
} > "$MANIFEST"
chmod 600 "$SQL_DEST" "$SQL_DEST.sha256" "$MANIFEST" 2>/dev/null || true
[ ! -f "$FILES_DEST" ] || chmod 600 "$FILES_DEST" "$FILES_DEST.sha256" 2>/dev/null || true

printf 'Database backup: %s\n' "$SQL_DEST"
[ ! -f "$FILES_DEST" ] || printf 'Connector files: %s\n' "$FILES_DEST"
printf 'Manifest: %s\n' "$MANIFEST"
printf 'IMPORTANT: store an encrypted off-VPS copy together with the separately protected CONNECTION_SECRETS_MASTER_KEY.\n'
