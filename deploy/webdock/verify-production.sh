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
for service in db browser app worker caddy; do
  if ! docker compose -f "$COMPOSE_FILE" --env-file .env ps --status running --services | grep -qx "$service"; then
    echo "Required service is not running: $service" >&2
    exit 1
  fi
done
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T db sh -ec 'mariadb -uamarktai -p"$MARIADB_PASSWORD" -e "SELECT 1 AS database_ready" amarktai_sales_assistant >/dev/null'
docker compose -f "$COMPOSE_FILE" --env-file .env run --rm --no-deps app pnpm drizzle-kit migrate
for path in / /auth /healthz /readyz /favicon.svg /assets/hero-white-model.png /assets/workflow-visual.png /assets/coaching-visual.png /assets/trust-visual.png /assets/auth-security-visual.png; do
  docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app curl -fsS "http://localhost:3000$path" >/dev/null
done
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app sh -ec '! grep -RInE "manus-storage|vite-plugin-manus|BUILT_IN_FORGE|VITE_OAUTH|OAUTH_SERVER_URL" dist >/dev/null'
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T app pnpm exec tsx server/verifyIntegrations.ts

if [ -n "${VERIFY_PUBLIC_URL:-}" ]; then
  curl -fsS --max-time 20 "$VERIFY_PUBLIC_URL/" >/dev/null
  curl -fsS --max-time 20 "$VERIFY_PUBLIC_URL/auth" >/dev/null
  headers="$(curl -fsSI --max-time 20 "$VERIFY_PUBLIC_URL/healthz")"
  printf '%s\n' "$headers" | grep -qi '^strict-transport-security:'
  printf '%s\n' "$headers" | grep -qi '^content-security-policy:'
  printf '%s\n' "$headers" | grep -qi '^x-content-type-options: nosniff'
  echo "Public TLS and reverse-proxy header verification passed."
else
  echo "Public TLS/header check skipped: set VERIFY_PUBLIC_URL=https://your-domain after DNS and certificate issuance."
fi

echo "Production verification passed. Optional GenX, Genie, and Outlook results are shown above and are only required to pass when configured."
