#!/usr/bin/env sh
set -eu

ROOT_DIR="${AMARKTAI_ROOT:-/opt/amarktai-sales-assistant}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
COMPOSE_FILE="$ROOT_DIR/deploy/webdock/docker-compose.yml"

cd "$ROOT_DIR"
set -a
. ./.env
set +a
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
MYSQL_PWD="$DB_ROOT_PASSWORD" docker compose -f "$COMPOSE_FILE" --env-file .env exec -T db mariadb-dump -uroot --single-transaction --routines --events amarktai_sales_assistant > "$BACKUP_DIR/amarktai-$stamp.sql"
tar -C "$ROOT_DIR" -czf "$BACKUP_DIR/amarktai-config-$stamp.tar.gz" .env deploy/webdock/config files
echo "Backup written to $BACKUP_DIR for $stamp"
