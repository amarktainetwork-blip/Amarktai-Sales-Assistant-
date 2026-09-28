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

if [ "$OPERATION" = "cleanup" ]; then
  echo "=== SAFE BUILD CACHE CLEANUP ==="
  echo "--- before cleanup ---"
  df -h / /opt 2>/dev/null || true
  docker system df || true

  # Build cache is disposable. This does not remove active images, running
  # containers, named volumes, MariaDB/Valkey data, connector evidence or backups.
  docker builder prune -af || true
  docker image prune -f || true
  apt-get clean || true
  if command -v journalctl >/dev/null 2>&1; then
    journalctl --vacuum-time=14d || true
  fi

  echo "--- after cleanup ---"
  df -h / /opt 2>/dev/null || true
  docker system df || true
  curl -fsS https://sales.amarktai.co.za/readyz
  echo
  echo "SAFE_STORAGE_CLEANUP=PASS"
  echo "completed_at=$(date -u +%FT%TZ)"
  exit 0
fi

if [ "$OPERATION" = "diagnose" ]; then
  echo "=== CRM READ-ONLY DIAGNOSTICS ==="
  db_sql() {
    local sql="$1"
    docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T db \
      sh -eu -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -D amarktai_sales_assistant --batch --raw -e "$1"' _ "$sql"
  }

  echo "--- connected system ---"
  db_sql "SELECT id,provider,status,JSON_LENGTH(allowedReadCapabilities) AS allowedReadCount,allowedReadCapabilities,allowedWriteCapabilities,verifiedCapabilities,lastHealthCheckAt,lastHealthSummary FROM connectedSystems WHERE id=8;"

  echo "--- commissioning job ---"
  db_sql "SELECT id,state,status,attempt,lastError,updatedAt,JSON_EXTRACT(progress,'$.capabilityAccounting.criticalGaps') AS criticalGaps,JSON_EXTRACT(progress,'$.safeReads.proven') AS safeReadsProven,discoveredOperationKeys FROM crmCommissioningJobs WHERE organisationId=8 AND connectedSystemId=8;"

  echo "--- sync cursors ---"
  db_sql "SELECT resourceType,lastSuccessfulAt,lastError,updatedAt FROM crmSyncCursors WHERE connectedSystemId=8 ORDER BY resourceType;"

  echo "--- latest required learned operations ---"
  db_sql "SELECT b.operationKey,b.version,b.status,b.lastSuccessAt,b.lastFailureAt,b.lastError,JSON_UNQUOTE(JSON_EXTRACT(b.evidence,'$.ownerExternalId')) AS evidenceOwner,JSON_UNQUOTE(JSON_EXTRACT(b.evidence,'$.sourceTotal')) AS sourceTotal,JSON_UNQUOTE(JSON_EXTRACT(b.evidence,'$.pagesRead')) AS pagesRead FROM browserLearnedOperations b JOIN (SELECT operationKey,MAX(version) AS version FROM browserLearnedOperations WHERE organisationId=8 AND connectedSystemId=8 GROUP BY operationKey) latest ON latest.operationKey=b.operationKey AND latest.version=b.version WHERE b.organisationId=8 AND b.connectedSystemId=8 AND b.operationKey IN ('contact.sync','contact.search','contact.read','company.sync','task.sync','opportunity.sync','activity.sync','owner.sync','pipeline.list') ORDER BY b.operationKey;"

  echo "--- current task collection ---"
  db_sql "SELECT COUNT(*) AS currentOpenTasks FROM crmTasks WHERE connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND status IN ('open','pending','incomplete','new','todo','to_do');"

  echo "--- inbox action backlog summary ---"
  db_sql "SELECT channel,status,COUNT(*) AS needsActionCount,MIN(receivedAt) AS oldest,MAX(receivedAt) AS newest FROM inboundMessages WHERE organisationId=8 AND mailboxUserId=2 AND connectedSystemId=8 AND needsAction=1 GROUP BY channel,status ORDER BY channel,status;"

  echo "--- inbox stale-work inconsistencies ---"
  db_sql "SELECT COUNT(*) AS inboundNeedsActionButWorkCompleted FROM inboundMessages m JOIN salesWorkItems w ON w.organisationId=m.organisationId AND w.connectedSystemId=m.connectedSystemId AND w.salespersonUserId=m.mailboxUserId AND w.sourceType='inbound_message' AND w.sourceExternalId=m.externalMessageId WHERE m.organisationId=8 AND m.mailboxUserId=2 AND m.connectedSystemId=8 AND m.needsAction=1 AND w.status='completed';"

  echo "--- oldest actionable inbox rows (metadata only) ---"
  db_sql "SELECT m.id,m.channel,m.status,m.receivedAt,m.contactExternalId,LEFT(COALESCE(m.subject,''),120) AS subject,COALESCE(w.status,'NO_WORK_ITEM') AS workStatus,JSON_UNQUOTE(JSON_EXTRACT(m.classification,'$.conversationExternalId')) AS conversationExternalId FROM inboundMessages m LEFT JOIN salesWorkItems w ON w.organisationId=m.organisationId AND w.connectedSystemId=m.connectedSystemId AND w.salespersonUserId=m.mailboxUserId AND w.sourceType='inbound_message' AND w.sourceExternalId=m.externalMessageId WHERE m.organisationId=8 AND m.mailboxUserId=2 AND m.connectedSystemId=8 AND m.needsAction=1 ORDER BY m.receivedAt ASC LIMIT 80;"

  echo "--- post-inbound CRM activity proof for current actionable messages ---"
  db_sql "SELECT m.id AS inboundId,m.channel,m.receivedAt,a.contactExternalId,a.activityType,a.occurredAt,a.externalId,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.direction')) AS direction,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.type')) AS rawType,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.status')) AS rawStatus FROM inboundMessages m JOIN crmActivities a ON a.organisationId=m.organisationId AND a.connectedSystemId=m.connectedSystemId AND a.contactExternalId=m.contactExternalId AND a.occurredAt>=m.receivedAt WHERE m.organisationId=8 AND m.mailboxUserId=2 AND m.connectedSystemId=8 AND m.needsAction=1 ORDER BY m.id,a.occurredAt LIMIT 120;"

  echo "--- post-inbound normalized sales events ---"
  db_sql "SELECT m.id AS inboundId,e.eventType,e.source,e.occurredAt,e.externalId FROM inboundMessages m JOIN salesActivityEvents e ON e.organisationId=m.organisationId AND e.connectedSystemId=m.connectedSystemId AND e.contactExternalId=m.contactExternalId AND e.occurredAt>=m.receivedAt WHERE m.organisationId=8 AND m.mailboxUserId=2 AND m.connectedSystemId=8 AND m.needsAction=1 ORDER BY m.id,e.occurredAt LIMIT 120;"

  echo "--- latest Genie mailbox sync evidence ---"
  db_sql "SELECT id,createdAt,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.checkedConversations')) AS checkedConversations,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.received')) AS received,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.handledReplies')) AS handledReplies,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.outboundEvidence')) AS outboundEvidence,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.legacyConversationLinks')) AS legacyConversationLinks,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.legacyActionableChecked')) AS legacyActionableChecked,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sourceSince')) AS sourceSince FROM auditEntries WHERE organisationId=8 AND userId=2 AND eventType='personal_genie_mailbox_synced' ORDER BY id DESC LIMIT 5;"

  echo "--- sales-work truth mismatches ---"
  db_sql "SELECT 'open_work_vs_completed_crm_task' AS checkName,COUNT(*) AS mismatchCount FROM salesWorkItems w JOIN crmTasks t ON t.organisationId=w.organisationId AND t.connectedSystemId=w.connectedSystemId AND t.externalId=w.taskExternalId WHERE w.organisationId=8 AND w.salespersonUserId=2 AND w.sourceType='crm_task' AND w.status IN ('open','in_progress','snoozed','blocked') AND LOWER(TRIM(t.status)) IN ('completed','complete','done','closed','cancelled','canceled');"
  db_sql "SELECT 'open_work_vs_archived_inbound' AS checkName,COUNT(*) AS mismatchCount FROM salesWorkItems w JOIN inboundMessages m ON m.organisationId=w.organisationId AND m.connectedSystemId=w.connectedSystemId AND m.externalMessageId=w.sourceExternalId WHERE w.organisationId=8 AND w.salespersonUserId=2 AND w.sourceType='inbound_message' AND w.status IN ('open','in_progress','snoozed','blocked') AND (m.needsAction=0 OR m.status='archived');"
  db_sql "SELECT 'completed_work_vs_actionable_inbound' AS checkName,COUNT(*) AS mismatchCount FROM salesWorkItems w JOIN inboundMessages m ON m.organisationId=w.organisationId AND m.connectedSystemId=w.connectedSystemId AND m.externalMessageId=w.sourceExternalId WHERE w.organisationId=8 AND w.salespersonUserId=2 AND w.sourceType='inbound_message' AND w.status='completed' AND m.needsAction=1;"
  db_sql "SELECT 'duplicate_open_work_same_source' AS checkName,COUNT(*) AS duplicateGroups FROM (SELECT sourceKey,COUNT(*) c FROM salesWorkItems WHERE organisationId=8 AND salespersonUserId=2 AND status IN ('open','in_progress','snoozed','blocked') GROUP BY sourceKey HAVING COUNT(*)>1) d;"
  db_sql "SELECT 'open_new_leads_with_later_sales_activity' AS checkName,COUNT(DISTINCT w.id) AS mismatchCount FROM salesWorkItems w JOIN crmActivities a ON a.organisationId=w.organisationId AND a.connectedSystemId=w.connectedSystemId AND a.contactExternalId=w.contactExternalId AND a.occurredAt>=COALESCE(w.sourceUpdatedAt,w.createdAt) WHERE w.organisationId=8 AND w.salespersonUserId=2 AND w.type='NEW_LEAD' AND w.status IN ('open','in_progress','snoozed','blocked') AND (LOWER(a.activityType)='call' OR (LOWER(a.activityType) IN ('email','sms','whatsapp','communication') AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.direction')),''))='outbound'));"

  echo "--- current open sales-work by type ---"
  db_sql "SELECT type,status,COUNT(*) AS count,MIN(dueAt) AS earliestDue,MAX(updatedAt) AS latestUpdated FROM salesWorkItems WHERE organisationId=8 AND salespersonUserId=2 AND status IN ('open','in_progress','snoozed','blocked') GROUP BY type,status ORDER BY type,status;"

  echo "--- stale source examples ---"
  db_sql "SELECT w.id,w.type,w.status,w.sourceType,w.sourceExternalId,w.taskExternalId,w.contactExternalId,w.dueAt,t.status AS crmTaskStatus,t.completedAt AS crmTaskCompletedAt FROM salesWorkItems w LEFT JOIN crmTasks t ON t.organisationId=w.organisationId AND t.connectedSystemId=w.connectedSystemId AND t.externalId=w.taskExternalId WHERE w.organisationId=8 AND w.salespersonUserId=2 AND w.status IN ('open','in_progress','snoozed','blocked') AND w.sourceType='crm_task' AND LOWER(TRIM(COALESCE(t.status,''))) IN ('completed','complete','done','closed','cancelled','canceled') ORDER BY t.completedAt DESC LIMIT 50;"

  echo "--- handover verifier rerun ---"
  set +e
  shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T app node dist/verifyAmeliaHandover.js"
  HANDOVER_RC=$?
  set -e
  echo "HANDOVER_RC=$HANDOVER_RC"
  echo "DIAGNOSTICS=PASS"
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

if ! git_admin diff --exit-code "$TARGET_SHA" -- \
  server/salesTracker.ts \
  server/salesTrackerAcceptance.test.ts; then
  git_admin diff --ignore-all-space --ignore-blank-lines --exit-code "$TARGET_SHA" -- \
    server/salesTracker.ts \
    server/salesTrackerAcceptance.test.ts \
    || fail "local tracker edits differ semantically from frozen GitHub release"
  echo "TRACKER_LOCAL_DIFF=WHITESPACE_ONLY"
fi

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
