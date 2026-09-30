#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }
[ -f .env ] || { echo ".env is missing" >&2; exit 1; }
sh deploy/webdock/use-persistent-state.sh

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
# They are deliberately owned by the unprivileged application UID and may not
# be readable by the host deployment user. Stream the archive through the
# transient app container using the current Compose mounts, which has read
# access to both bind mounts without widening host permissions. Never archive .env, deployment secrets, Caddy data
# or database volumes.
mkdir -p deploy/webdock/config deploy/webdock/files/connector-evidence
$COMPOSE run --no-deps --rm -T --entrypoint sh app -eu -c '
  staging="$(mktemp -d /tmp/amarktai-backup.XXXXXX)"
  case "$staging" in /tmp/amarktai-backup.*) ;; *) echo "Unsafe backup staging path." >&2; exit 1 ;; esac
  mkdir -p "$staging/files"
  cp -a /app/config "$staging/config"
  cp -a /app/data/connector-evidence "$staging/files/connector-evidence"
  tar -czf - -C "$staging" config files/connector-evidence
  rm -rf -- "$staging"
' > "$FILES_DEST"
test -s "$FILES_DEST" || { rm -f "$FILES_DEST"; echo "Connector-file archive was empty; removed it." >&2; exit 1; }

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

# Keep ordinary deployment backups bounded. Named milestone/manual directories
# are intentionally excluded from this retention pass.
KEEP_STANDARD_BACKUPS="${AMARKTAI_BACKUP_KEEP_STANDARD:-20}"
case "$KEEP_STANDARD_BACKUPS" in
  ''|*[!0-9]*) echo "AMARKTAI_BACKUP_KEEP_STANDARD must be a non-negative integer." >&2; exit 1 ;;
esac
if [ "$KEEP_STANDARD_BACKUPS" -gt 0 ]; then
  standard_stamps="$(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'amarktai-*.manifest.txt' -printf '%f\n' 2>/dev/null |
      sed -n 's/^amarktai-\([0-9]\{8\}T[0-9]\{6\}Z\)\.manifest\.txt$/\1/p' |
      sort -r
  )"
  printf '%s\n' "$standard_stamps" |
    awk -v keep="$KEEP_STANDARD_BACKUPS" 'NF && NR > keep { print }' |
    while IFS= read -r old_stamp; do
      [ -n "$old_stamp" ] || continue
      rm -f -- \
        "$BACKUP_DIR/amarktai-${old_stamp}.sql.gz" \
        "$BACKUP_DIR/amarktai-${old_stamp}.sql.gz.sha256" \
        "$BACKUP_DIR/amarktai-${old_stamp}-connector-files.tar.gz" \
        "$BACKUP_DIR/amarktai-${old_stamp}-connector-files.tar.gz.sha256" \
        "$BACKUP_DIR/amarktai-${old_stamp}.manifest.txt"
    done
fi

printf 'Database backup: %s\n' "$SQL_DEST"
[ ! -f "$FILES_DEST" ] || printf 'Connector files: %s\n' "$FILES_DEST"
printf 'Manifest: %s\n' "$MANIFEST"
printf 'IMPORTANT: store an encrypted off-VPS copy together with the separately protected CONNECTION_SECRETS_MASTER_KEY.\n'
