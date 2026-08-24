#!/usr/bin/env sh
set -eu

PROFILE="${AMARKTAI_DEPLOY_PROFILE:-full}"
COMPOSE_FILE="deploy/webdock/docker-compose.yml"
[ "$PROFILE" = "pilot" ] && COMPOSE_FILE="deploy/webdock/docker-compose.pilot.yml"
[ "$PROFILE" = "pilot" ] || [ "$PROFILE" = "full" ] || { echo "AMARKTAI_DEPLOY_PROFILE must be pilot or full" >&2; exit 1; }
[ -f .env ] || { echo ".env is required" >&2; exit 1; }

AMARKTAI_DEPLOY_PROFILE="$PROFILE" sh deploy/webdock/preflight.sh .env
COMPOSE="docker compose -f $COMPOSE_FILE --env-file .env"
$COMPOSE config >/dev/null

running="$($COMPOSE ps --status running --services)"
require_service() {
  printf '%s\n' "$running" | grep -qx "$1" || { echo "Required service '$1' is not running." >&2; $COMPOSE ps; exit 1; }
}

for service in caddy app worker reporter db redis; do require_service "$service"; done
if [ "$PROFILE" != "pilot" ]; then
  require_service browser
  require_service stt
  require_service tts
fi

$COMPOSE exec -T db sh -eu -c 'mariadb-admin ping -uroot -p"$MARIADB_ROOT_PASSWORD" --silent'
$COMPOSE exec -T db sh -eu -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -D amarktai_sales_assistant -Nse "SELECT 1"' | grep -qx 1
$COMPOSE exec -T redis valkey-cli ping | grep -qx PONG
[ "$PROFILE" = "pilot" ] || $COMPOSE exec -T browser curl -fsS http://127.0.0.1:9222/json/version >/dev/null
[ "$PROFILE" = "pilot" ] || $COMPOSE exec -T stt curl -fsS http://127.0.0.1:8080/ >/dev/null
[ "$PROFILE" = "pilot" ] || $COMPOSE exec -T tts python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/info', timeout=3).read()"

$COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>{const b=await r.text(); if(!r.ok) throw new Error(b); console.log(b)}).catch(e=>{console.error(e);process.exit(1)})"
$COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/readyz').then(async r=>{const b=await r.text(); if(!r.ok) throw new Error(b); console.log(b)}).catch(e=>{console.error(e);process.exit(1)})"
$COMPOSE exec -T app node dist/verifyIntegrations.js

DOMAIN="$(grep '^DOMAIN=' .env | tail -1 | cut -d= -f2-)"
PUBLIC_URL="${VERIFY_PUBLIC_URL:-https://$DOMAIN}"
PUBLIC_URL="${PUBLIC_URL%/}"
HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT HUP INT TERM

curl --fail --silent --show-error --location --retry 5 --retry-delay 2 --connect-timeout 10 --max-time 30 -D "$HEADERS" "$PUBLIC_URL/healthz" >/dev/null
curl --fail --silent --show-error --location --retry 3 --retry-delay 2 --connect-timeout 10 --max-time 30 "$PUBLIC_URL/readyz" >/dev/null
curl --fail --silent --show-error --location --connect-timeout 10 --max-time 30 "$PUBLIC_URL/" >/dev/null

grep -Eqi '^strict-transport-security:.*max-age=' "$HEADERS" || { echo "Public HSTS header is missing." >&2; exit 1; }
grep -Eqi '^x-content-type-options:[[:space:]]*nosniff' "$HEADERS" || { echo "Public nosniff header is missing." >&2; exit 1; }
grep -Eqi '^x-frame-options:[[:space:]]*DENY' "$HEADERS" || { echo "Public frame-deny header is missing." >&2; exit 1; }
grep -Eqi '^permissions-policy:.*microphone=\(self\)' "$HEADERS" || { echo "Public microphone policy does not permit same-origin Live Call Companion access." >&2; exit 1; }

VERIFY_PUBLIC_URL="$PUBLIC_URL" FEATURE_VERIFY_LIVE_VOICE=true $COMPOSE exec -T \
  -e VERIFY_PUBLIC_URL="$PUBLIC_URL" \
  -e FEATURE_VERIFY_LIVE_VOICE=true \
  app node dist/verifyFeatures.js

printf 'RELEASE_SHA=%s\n' "$(git rev-parse HEAD 2>/dev/null || printf unknown)"
printf 'PROFILE=%s\n' "$PROFILE"
printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
printf 'DATABASE=PASS\nVALKEY=PASS\nAPP_HEALTH=PASS\nAPP_READINESS=PASS\nINTEGRATIONS=PASS\nPUBLIC_TLS=PASS\nSECURITY_HEADERS=PASS\n'
[ "$PROFILE" = "pilot" ] || printf 'BROWSER_RUNTIME=PASS\n'
[ "$PROFILE" = "pilot" ] || printf 'STT_RUNTIME=PASS\nTTS_RUNTIME=PASS\nVOICE_ACCEPTANCE=PASS\n'
printf 'PRODUCTION_VERIFIER=PASS\n'
printf 'FEATURE_ACCEPTANCE=PASS\n'
