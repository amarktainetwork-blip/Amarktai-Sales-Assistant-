#!/usr/bin/env bash
set -Eeuo pipefail

OPERATION="__OPERATION__"
TARGET_SHA="__TARGET_SHA__"
REPO="/opt/amarktai-sales"
ADMIN_USER="admin"
PUBLIC_REPO_URL="https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git"
FULL_LOG="/tmp/amarktai-control-full.log"
REPORT="/tmp/amarktai-control-report.log"

git_admin() {
  sudo -H -u "$ADMIN_USER" git -C "$REPO" "$@"
}

shell_admin() {
  sudo -H -u "$ADMIN_USER" bash -lc "cd '$REPO' && $1"
}

: > "$FULL_LOG"
: > "$REPORT"
finish_report() {
  rc=$?
  {
    echo
    echo "=== CONTROL REPORT TAIL ==="
    tail -c 80000 "$FULL_LOG" 2>/dev/null || true
    echo
    echo "control_exit_code=$rc"
  } > "$REPORT"
}
trap finish_report EXIT
exec > >(tee "$FULL_LOG") 2>&1

echo "AMARKTAI_WEBDOCK_CONTROL=START"
echo "operation=$OPERATION"
echo "target_sha=$TARGET_SHA"
echo "started_at=$(date -u +%FT%TZ)"
echo "hostname=$(hostname)"
echo "user=$(id -un)"

fail() {
  echo "CONTROL_FAIL=$*"
  exit 1
}

[ -d "$REPO/.git" ] || fail "production repository missing at $REPO"
cd "$REPO"

echo "=== BEFORE: GIT ==="
git_admin rev-parse HEAD
git_admin status --short --branch

echo "=== BEFORE: STORAGE ==="
df -h / /opt 2>/dev/null || true
docker system df || true

echo "=== BEFORE: SERVICES ==="
docker ps --format '{{.Names}}|{{.Status}}' | sort || true

echo "=== BEFORE: READINESS ==="
curl -fsS https://sales.amarktai.co.za/readyz || true
echo

if [ "$OPERATION" = "inspect" ]; then
  echo "INSPECT_ONLY=PASS"
  echo "completed_at=$(date -u +%FT%TZ)"
  exit 0
fi

if [ "$OPERATION" = "verify" ]; then
  test "$(git_admin rev-parse HEAD)" = "$TARGET_SHA" || fail "live repo is not on target SHA"
  shell_admin "AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/verify-production.sh"
  shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T app node dist/verifyAmeliaHandover.js"
  set +e
  shell_admin "AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/verify-client-acceptance.sh"
  CLIENT_RC=$?
  set -e
  if [ "$CLIENT_RC" -eq 0 ]; then
    echo "STRICT_CLIENT_ACCEPTANCE=PASS"
  else
    echo "STRICT_CLIENT_ACCEPTANCE=PENDING_BROWSER_UAT"
  fi
  echo "VERIFY_ONLY=PASS"
  echo "completed_at=$(date -u +%FT%TZ)"
  exit 0
fi

[ "$OPERATION" = "deploy" ] || fail "unsupported operation: $OPERATION"

echo "=== RELEASE PRE-FLIGHT ==="
git_admin fetch --quiet "$PUBLIC_REPO_URL" main
FETCHED_SHA="$(git_admin rev-parse FETCH_HEAD)"
echo "fetched_main=$FETCHED_SHA"
[ "$FETCHED_SHA" = "$TARGET_SHA" ] || fail "public GitHub main does not equal frozen target SHA"

unexpected="$(git_admin status --porcelain | sed 's/^...//' | grep -v -E '^(server/salesTracker.ts|server/salesTrackerAcceptance.test.ts)$' || true)"
if [ -n "$unexpected" ]; then
  echo "$unexpected"
  fail "unexpected working-tree changes; refusing deployment"
fi

git_admin diff --exit-code "$TARGET_SHA" -- \
  server/salesTracker.ts \
  server/salesTrackerAcceptance.test.ts \
  || fail "local tracker edits differ from frozen GitHub release"

echo "=== PRE-CLEANUP BACKUP ==="
shell_admin "AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/backup.sh"
latest_sql="$(ls -1t deploy/webdock/backups/amarktai-*.sql.gz 2>/dev/null | head -1 || true)"
[ -n "$latest_sql" ] && gzip -t "$latest_sql" || fail "fresh database backup missing or invalid"
echo "fresh_backup=$latest_sql"

echo "=== SAFE STORAGE CLEANUP ==="
echo "--- before cleanup ---"
df -h / /opt 2>/dev/null || true
docker system df || true

tmp_ids="$(docker ps -aq --filter 'name=^webdock-app-run-' || true)"
if [ -n "$tmp_ids" ]; then
  docker rm -f $tmp_ids
fi

docker image prune -f || true
docker builder prune -f --filter 'until=168h' || true
apt-get clean || true
if command -v journalctl >/dev/null 2>&1; then
  journalctl --vacuum-time=14d || true
fi

echo "--- after cleanup ---"
df -h / /opt 2>/dev/null || true
docker system df || true

echo "=== APPLY FROZEN RELEASE ==="
git_admin reset --hard "$TARGET_SHA"
test "$(git_admin rev-parse HEAD)" = "$TARGET_SHA" || fail "failed to set frozen release SHA"

shell_admin "AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/update.sh"

echo "=== PRODUCTION VERIFICATION ==="
test "$(git_admin rev-parse HEAD)" = "$TARGET_SHA" || fail "post-deploy SHA mismatch"
shell_admin "AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/verify-production.sh"

echo "=== AMELIA HANDOVER VERIFICATION ==="
shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T app node dist/verifyAmeliaHandover.js"

echo "=== STRICT CLIENT ACCEPTANCE ==="
set +e
shell_admin "AMARKTAI_DEPLOY_PROFILE=full sh deploy/webdock/verify-client-acceptance.sh"
CLIENT_RC=$?
set -e
if [ "$CLIENT_RC" -eq 0 ]; then
  echo "STRICT_CLIENT_ACCEPTANCE=PASS"
else
  echo "STRICT_CLIENT_ACCEPTANCE=PENDING_BROWSER_UAT"
fi

echo "=== FINAL SAFETY/TRUTH ==="
echo "release_sha=$(git_admin rev-parse HEAD)"
curl -fsS https://sales.amarktai.co.za/readyz
echo
shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml ps"

echo "=== FINAL STORAGE ==="
df -h / /opt 2>/dev/null || true
docker system df || true

echo "DEPLOYMENT=PASS"
echo "GENIE_WRITES=UNCHANGED_READ_ONLY_POLICY"
echo "completed_at=$(date -u +%FT%TZ)"
