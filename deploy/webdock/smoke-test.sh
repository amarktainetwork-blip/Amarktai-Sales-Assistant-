#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }

COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"
$COMPOSE ps

$COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>{const b=await r.text(); if(!r.ok) throw new Error(b); console.log(b)}).catch(e=>{console.error(e);process.exit(1)})"
$COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/readyz').then(async r=>{const b=await r.text(); if(!r.ok) throw new Error(b); console.log(b)}).catch(e=>{console.error(e);process.exit(1)})"
$COMPOSE exec -T db sh -eu -c 'mariadb-admin ping -uroot -p"$MARIADB_ROOT_PASSWORD" --silent'
$COMPOSE exec -T redis valkey-cli ping | grep -qx PONG

if [ "$PROFILE" = "full" ]; then
  $COMPOSE exec -T browser curl -fsS http://127.0.0.1:9222/json/version >/dev/null
fi

printf 'Smoke test passed for %s profile.\n' "$PROFILE"
