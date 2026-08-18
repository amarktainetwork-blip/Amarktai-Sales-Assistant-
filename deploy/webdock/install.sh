#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this installer as a non-root sudo user." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Follow docs/webdock-vps-install.md before running this installer." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp deploy/webdock/configuration.template .env
  echo "Created .env from deploy/webdock/configuration.template. Fill every required value before continuing." >&2
  exit 1
fi

mkdir -p config files/screenshots
if [ ! -f config/genie-scripts.json ]; then
  cp deploy/webdock/genie-scripts.template.json config/genie-scripts.json
  echo "Created config/genie-scripts.json. Calibrate every REPLACE_* selector before enabling Genie writes." >&2
fi

docker compose -f deploy/webdock/docker-compose.yml --env-file .env build
docker compose -f deploy/webdock/docker-compose.yml --env-file .env up -d db redis browser
docker compose -f deploy/webdock/docker-compose.yml --env-file .env run --rm app pnpm drizzle-kit migrate
docker compose -f deploy/webdock/docker-compose.yml --env-file .env up -d
docker compose -f deploy/webdock/docker-compose.yml --env-file .env ps
