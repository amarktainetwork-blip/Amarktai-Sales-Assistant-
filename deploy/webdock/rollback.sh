#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <known-good-git-sha-or-tag>" >&2
  exit 64
fi

ROOT_DIR="${AMARKTAI_ROOT:-/opt/amarktai-sales-assistant}"
cd "$ROOT_DIR"
./deploy/webdock/backup.sh
git checkout "$1"
./deploy/webdock/install.sh
