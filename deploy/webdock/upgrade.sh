#!/usr/bin/env sh
set -eu

ROOT_DIR="${AMARKTAI_ROOT:-/opt/amarktai-sales-assistant}"
cd "$ROOT_DIR"
./deploy/webdock/backup.sh
git fetch origin main --tags
git checkout main
git pull --ff-only origin main
./deploy/webdock/install.sh
