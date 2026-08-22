#!/bin/sh
set -eu

: "${APP_INTERNAL_URL:=http://app:3000}"
: "${INTERNAL_SCHEDULER_TOKEN:?INTERNAL_SCHEDULER_TOKEN is required}"

echo "Amarktai self-hosted worker started"
last_genie_check=""
while true; do
  curl --fail --silent --show-error --max-time 30 \
    -X POST "${APP_INTERNAL_URL}/internal/scheduler/daily-reports" \
    -H "Authorization: Bearer ${INTERNAL_SCHEDULER_TOKEN}" \
    -H "Content-Type: application/json" >/dev/null || echo "Daily report scheduler run failed"

  current_slot="$(date -u +%Y-%m-%d-%H)"
  current_hour="$(date -u +%H)"
  if [ "$current_hour" = "00" ] || [ "$current_hour" = "12" ]; then
    if [ "$last_genie_check" != "$current_slot" ]; then
      /app/scripts/run-genie-health-check.sh || echo "Genie health check failed"
      last_genie_check="$current_slot"
    fi
  fi
  sleep 60
done
