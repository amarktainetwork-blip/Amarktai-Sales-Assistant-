#!/usr/bin/env bash
set -uo pipefail
expected="${1:-${EXPECTED_RELEASE_SHA:-}}"
failed=0
check(){ if "$@"; then return 0; else failed=1; return 1; fi; }
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo 'FAIL EXPECTED_RELEASE_SHA_REQUIRED'; exit 1; }
for service in app worker reporter; do
  name="webdock-${service}-1"
  revision="$(docker inspect "$name" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)"
  running="$(docker inspect "$name" --format '{{.State.Running}}' 2>/dev/null)"
  if [[ "$revision" == "$expected" && "$running" == true ]]; then echo "PASS ${service^^}_REVISION_RUNNING"; else echo "FAIL ${service^^}_REVISION_RUNNING"; failed=1; fi
  health="$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null)"
  if [[ "$service" == worker && "$health" != healthy ]]; then echo 'FAIL WORKER_HEALTH'; failed=1; fi
  [[ "$service" == reporter ]] && continue
  mount="$(docker inspect "$name" --format '{{range .Mounts}}{{if eq .Destination "/app/data/connector-evidence"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"
  if [[ "$(readlink -f "$mount")" == /opt/amarktai-sales/deploy/webdock/files/connector-evidence ]]; then echo "PASS ${service^^}_PERSISTENT_STATE"; else echo "FAIL ${service^^}_PERSISTENT_STATE"; failed=1; fi
done
if [[ "$(curl --max-time 20 -s -o /dev/null -w '%{http_code}' https://sales.amarktai.co.za/health)" == 200 ]]; then echo 'PASS PUBLIC_HEALTH'; else echo 'FAIL PUBLIC_HEALTH'; failed=1; fi
if [[ "$(git rev-parse HEAD)" == "$expected" && "$(git rev-parse origin/main)" == "$expected" ]]; then echo 'PASS RELEASE_MAIN'; else echo 'FAIL RELEASE_MAIN'; failed=1; fi
docker exec webdock-app-1 node dist/verifyAmeliaHandover.js || failed=1
exit "$failed"
