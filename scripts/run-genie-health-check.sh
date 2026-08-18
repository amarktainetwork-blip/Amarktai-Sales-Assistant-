#!/usr/bin/env sh
set -eu
cd /app
./node_modules/.bin/tsx server/genie/healthCheck.ts
