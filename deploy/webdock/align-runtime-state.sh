#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || {
  echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2
  exit 1
}
COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"

mkdir -p deploy/webdock/files/connector-evidence
APP_RUNTIME_IDS="$($COMPOSE run --no-deps --rm --entrypoint sh app -c 'printf "%s:%s" "$(id -u)" "$(id -g)"')"
case "$APP_RUNTIME_IDS" in
  *:*) ;;
  *)
    echo "Could not resolve application runtime uid/gid from the built image." >&2
    exit 1
    ;;
esac

$COMPOSE run --no-deps --rm --user 0:0 --entrypoint sh app -c "
  chown -R '$APP_RUNTIME_IDS' /app/data/connector-evidence
  chmod 700 /app/data/connector-evidence
"
