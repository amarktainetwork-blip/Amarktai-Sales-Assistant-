#!/usr/bin/env sh
set -eu

ROOT_DIR="${AMARKTAI_ROOT:-/opt/amarktai-sales-assistant}"
COMPOSE_FILE="$ROOT_DIR/deploy/webdock/docker-compose.yml"

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "Missing $ROOT_DIR/.env" >&2
  exit 1
fi

cd "$ROOT_DIR"
docker compose -f "$COMPOSE_FILE" --env-file .env config -q
echo "COMPOSE=PASS"
for service in db browser app worker caddy; do
  if ! docker compose -f "$COMPOSE_FILE" --env-file .env ps --status running --services | grep -qx "$service"; then
    echo "Required service is not running: $service" >&2
    exit 1
  fi
done
echo "SERVICES=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T db sh -ec 'mariadb -uamarktai -p"$MARIADB_PASSWORD" -e "SELECT 1 AS database_ready" amarktai_sales_assistant >/dev/null'
echo "DATABASE=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env run --rm --no-deps app pnpm drizzle-kit migrate
echo "MIGRATIONS=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app curl -fsS http://localhost:3000/healthz >/dev/null
echo "APP_HEALTH=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app curl -fsS http://localhost:3000/readyz >/dev/null
echo "READINESS=PASS"
for path in / /auth /healthz /readyz /favicon.svg /assets/hero-white-model.png /assets/workflow-visual.png /assets/coaching-visual.png /assets/trust-visual.png /assets/auth-security-visual.png; do
  docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app curl -fsS "http://localhost:3000$path" >/dev/null
done
echo "ASSETS=PASS"
echo "AUTH_ROUTE=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app sh -ec '! grep -RInE "manus-storage|vite-plugin-manus|BUILT_IN_FORGE|VITE_OAUTH|OAUTH_SERVER_URL" dist >/dev/null'
echo "MANUS_PRODUCTION_DEPENDENCIES_REMOVED=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app node -e 'fetch(`http://browser:3000/pressure?token=${process.env.BROWSERLESS_TOKEN}`).then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));'
echo "BROWSER_RUNTIME=PASS"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app pnpm exec tsx server/verifyIntegrations.ts

if [ -n "${VERIFY_PUBLIC_URL:-}" ]; then
  curl -fsS --max-time 20 "$VERIFY_PUBLIC_URL/" >/dev/null
  curl -fsS --max-time 20 "$VERIFY_PUBLIC_URL/auth" >/dev/null
  headers="$(curl -fsSI --max-time 20 "$VERIFY_PUBLIC_URL/healthz")"
  printf '%s\n' "$headers" | grep -qi '^strict-transport-security:'
  printf '%s\n' "$headers" | grep -qi '^content-security-policy:'
  printf '%s\n' "$headers" | grep -qi '^x-content-type-options: nosniff'
  echo "PUBLIC_TLS_HEADERS=PASS"
else
  echo "PUBLIC_TLS_HEADERS=BLOCKED"
fi

echo "PRODUCTION_VERIFIER=PASS"
