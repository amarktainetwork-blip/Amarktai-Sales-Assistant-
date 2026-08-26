#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }
[ -f .env ] || { echo ".env is required" >&2; exit 1; }

COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"
$COMPOSE config >/dev/null

DOMAIN="$(grep '^DOMAIN=' .env | tail -1 | cut -d= -f2-)"
PUBLIC_URL="${VERIFY_PUBLIC_URL:-https://$DOMAIN}"
PUBLIC_URL="${PUBLIC_URL%/}"

printf 'Running strict 34-feature client acceptance. This remains non-zero until client commissioning evidence is green.\n'
VERIFY_PUBLIC_URL="$PUBLIC_URL" FEATURE_VERIFY_LIVE_VOICE=true $COMPOSE exec -T \
  -e VERIFY_PUBLIC_URL="$PUBLIC_URL" \
  -e FEATURE_VERIFY_LIVE_VOICE=true \
  app node dist/verifyFeatures.js

printf 'RELEASE_SHA=%s\n' "$(git rev-parse HEAD 2>/dev/null || printf unknown)"
printf 'CLIENT_ACCEPTANCE=PASS\n'
