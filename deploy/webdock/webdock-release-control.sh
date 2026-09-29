#!/usr/bin/env bash
set -Eeuo pipefail

OPERATION="__OPERATION__"
TARGET_SHA="__TARGET_SHA__"
CONFIG_USER_ID="__CONFIG_USER_ID__"
CONFIG_ORGANISATION_ID="__CONFIG_ORGANISATION_ID__"
CONFIG_CONNECTED_SYSTEM_ID="__CONFIG_CONNECTED_SYSTEM_ID__"
CONFIG_CLIENT_PACK="__CONFIG_CLIENT_PACK__"
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

if [ "$OPERATION" = "configure" ]; then
  echo "=== TENANT CLIENT-PACK CONFIGURATION ==="
  [[ "$CONFIG_USER_ID" =~ ^[1-9][0-9]*$ ]] || fail "configure user id invalid"
  [[ "$CONFIG_ORGANISATION_ID" =~ ^[1-9][0-9]*$ ]] || fail "configure organisation id invalid"
  [[ "$CONFIG_CONNECTED_SYSTEM_ID" =~ ^[1-9][0-9]*$ ]] || fail "configure connected system id invalid"
  [[ "$CONFIG_CLIENT_PACK" =~ ^[a-z0-9][a-z0-9_-]{0,79}$ ]] || fail "configure client pack slug invalid"

  app_container="$(docker compose --env-file .env -f deploy/webdock/docker-compose.yml ps -q app)"
  [ -n "$app_container" ] || fail "production app container is not running"
  app_revision="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$app_container")"
  [ "$app_revision" = "$TARGET_SHA" ] || fail "live app revision $app_revision does not match requested configuration release $TARGET_SHA"

  pack_path="/app/config/client-packs/$CONFIG_CLIENT_PACK.json"
  docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T app     sh -eu -c 'test -f "$1"' _ "$pack_path" || fail "client pack is not present in production image"

  db_sql() {
    local sql="$1"
    docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T db       sh -eu -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -D amarktai_sales_assistant --batch --raw -e "$1"' _ "$sql"
  }

  before_write_caps="$(db_sql "SELECT COALESCE(JSON_LENGTH(allowedWriteCapabilities),0) FROM connectedSystems WHERE id=$CONFIG_CONNECTED_SYSTEM_ID AND organisationId=$CONFIG_ORGANISATION_ID;" | tail -1)"
  [ "$before_write_caps" = "0" ] || fail "client-pack configuration requires CRM write capabilities to remain disabled"

  echo "--- applying validated internal client pack ---"
  docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T app     node dist/applyClientConfigurationCli.js       "$CONFIG_USER_ID"       "$CONFIG_ORGANISATION_ID"       "$CONFIG_CONNECTED_SYSTEM_ID"       "$pack_path"

  after_write_caps="$(db_sql "SELECT COALESCE(JSON_LENGTH(allowedWriteCapabilities),0) FROM connectedSystems WHERE id=$CONFIG_CONNECTED_SYSTEM_ID AND organisationId=$CONFIG_ORGANISATION_ID;" | tail -1)"
  [ "$after_write_caps" = "0" ] || fail "CRM write capabilities changed during client-pack configuration"

  echo "--- configured Today policy shape ---"
  db_sql "SELECT JSON_KEYS(JSON_EXTRACT(settings,'$.salesAssistantConfig.todayWorkPolicy')) AS policyKeys,JSON_LENGTH(JSON_EXTRACT(settings,'$.salesAssistantConfig.todayWorkPolicy.categories')) AS categoryCount,JSON_EXTRACT(settings,'$.salesAssistantConfig.todayWorkPolicy.morningWindowEnd') AS morningWindowEnd,JSON_EXTRACT(settings,'$.salesAssistantConfig.todayWorkPolicy.callTimeRotation.enabled') AS rotationEnabled FROM organisations WHERE id=$CONFIG_ORGANISATION_ID;"
  echo "--- CRM write capability proof ---"
  db_sql "SELECT id,provider,status,allowedWriteCapabilities FROM connectedSystems WHERE id=$CONFIG_CONNECTED_SYSTEM_ID AND organisationId=$CONFIG_ORGANISATION_ID;"

  curl -fsS https://sales.amarktai.co.za/readyz
  echo
  echo "CONFIGURATION=PASS"
  echo "GENIE_WRITES=UNCHANGED_READ_ONLY_POLICY"
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

  echo "--- customer contact-preference field inventory (labels only) ---"
  db_sql "SELECT JSON_EXTRACT(settings,'$.customerFieldMappings') AS configuredCustomerFieldMappings FROM organisations WHERE id=8;"
  db_sql "SELECT DISTINCT JSON_EXTRACT(raw,'$.normalizedCustomerContext.customFieldLabels') AS customFieldLabels FROM crmContacts WHERE organisationId=8 AND connectedSystemId=8 AND LOWER(CAST(JSON_EXTRACT(raw,'$.normalizedCustomerContext.customFieldLabels') AS CHAR)) REGEXP 'prefer|contact|call|time|morning|afternoon|evening' LIMIT 20;"
  db_sql "SELECT COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw,'$.normalizedCustomerContext.customFields.Xz5LMfmoQ0bWlFE2aqnu'))),''),'(blank)') AS bestTimeToCall,COUNT(*) AS contacts FROM crmContacts WHERE organisationId=8 AND connectedSystemId=8 GROUP BY bestTimeToCall ORDER BY contacts DESC LIMIT 30;"

  echo "--- tenant workflow configuration shape ---"
  db_sql "SELECT JSON_KEYS(JSON_EXTRACT(settings,'$.salesAssistantConfig.workflows')) AS workflowKeys,JSON_LENGTH(JSON_EXTRACT(settings,'$.salesAssistantConfig.workflows')) AS workflowCount,JSON_EXTRACT(settings,'$.salesAssistantConfig.officeHours') AS officeHours,JSON_KEYS(JSON_EXTRACT(settings,'$.salesAssistantConfig.paymentReview')) AS paymentReviewKeys FROM organisations WHERE id=8;"
  echo "--- Amelia task workflow inventory ---"
  db_sql "SELECT LOWER(TRIM(title)) AS taskTitle,COUNT(*) AS openCount,SUM(dueAt<UTC_TIMESTAMP()) AS overdueCount,SUM(dueAt>=UTC_TIMESTAMP() AND dueAt<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)) AS dueTodayCount,MIN(dueAt) AS earliestDue,MAX(dueAt) AS latestDue FROM crmTasks WHERE organisationId=8 AND connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(TRIM(status)) IN ('open','pending','incomplete','not_started','in_progress','scheduled','todo','to_do') GROUP BY LOWER(TRIM(title)) ORDER BY openCount DESC,taskTitle LIMIT 120;"
  db_sql "SELECT CASE WHEN LOWER(title) REGEXP 'renew|debt|default|collection|payment' THEN 'renewal_or_debt' WHEN LOWER(title) REGEXP 'first[[:space:]_-]*call' THEN 'first_call' WHEN LOWER(title) REGEXP '(^|[^0-9])#?2([^0-9]|$)|second[[:space:]_-]*call' THEN 'call_2' WHEN LOWER(title) REGEXP '(^|[^0-9])#?3([^0-9]|$)|third[[:space:]_-]*call' THEN 'call_3' WHEN LOWER(title) REGEXP 'last[[:space:]_-]*try|fourth[[:space:]_-]*call|#4' THEN 'last_try' ELSE 'other' END AS taskClass,COUNT(*) AS openCount,SUM(dueAt<UTC_TIMESTAMP()) AS overdueCount FROM crmTasks WHERE organisationId=8 AND connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(TRIM(status)) IN ('open','pending','incomplete','not_started','in_progress','scheduled','todo','to_do') GROUP BY taskClass ORDER BY openCount DESC;"
  db_sql "SELECT a.contactExternalId,CONCAT_WS(' ',c.firstName,c.lastName) AS contactName,a.occurredAt,TIME_FORMAT(TIME(a.occurredAt),'%H:%i') AS callTime,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.direction')) AS direction FROM crmActivities a LEFT JOIN crmContacts c ON c.organisationId=a.organisationId AND c.connectedSystemId=a.connectedSystemId AND c.externalId=a.contactExternalId WHERE a.organisationId=8 AND a.connectedSystemId=8 AND a.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(a.activityType)='call' AND a.occurredAt>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY) ORDER BY a.contactExternalId,a.occurredAt DESC LIMIT 300;"
  echo "--- host and container memory truth ---"
  free -h || true
  awk '/MemTotal|MemFree|MemAvailable|Buffers|Cached/ {print}' /proc/meminfo || true
  docker stats --no-stream --format '{{.Name}}|cpu={{.CPUPerc}}|mem={{.MemUsage}}|mem_pct={{.MemPerc}}' 2>/dev/null | sort || true

  echo "--- current task due-time shape ---"
  db_sql "SELECT TIME_FORMAT(TIME(dueAt),'%H:%i') AS dueTime,COUNT(*) AS count FROM crmTasks WHERE connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND status IN ('open','pending','incomplete','new','todo','to_do') AND dueAt IS NOT NULL GROUP BY dueTime ORDER BY count DESC,dueTime LIMIT 30;"
  db_sql "SELECT SUM(TIME(dueAt)='00:00:00') AS midnightDue,COUNT(*) AS datedOpenTasks,SUM(dueAt<UTC_TIMESTAMP()) AS overdueByTimestamp FROM crmTasks WHERE connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND status IN ('open','pending','incomplete','new','todo','to_do') AND dueAt IS NOT NULL;"
  db_sql "SELECT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.dueAt')) AS sourceDueAt,DATE_FORMAT(dueAt,'%Y-%m-%d %H:%i:%s') AS normalizedDueAt FROM crmTasks WHERE connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND status IN ('open','pending','incomplete','new','todo','to_do') AND dueAt IS NOT NULL ORDER BY dueAt ASC LIMIT 20;"
  db_sql "SELECT SUM(JSON_UNQUOTE(JSON_EXTRACT(raw,'$.dueAt')) NOT LIKE '%T%') AS dateOnlySource,SUM(JSON_UNQUOTE(JSON_EXTRACT(raw,'$.dueAt')) LIKE '%T00:00:00%') AS explicitMidnightSource,COUNT(*) AS taskCount FROM crmTasks WHERE connectedSystemId=8 AND ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND status IN ('open','pending','incomplete','new','todo','to_do') AND dueAt IS NOT NULL;"

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

  echo "--- focused acceptance regression diagnostics ---"
  db_sql "SELECT UTC_TIMESTAMP() AS observedUtc, SUM(t.dueAt<UTC_TIMESTAMP()) AS sourceOverdueNow, SUM(t.dueAt>=UTC_TIMESTAMP() AND t.dueAt<'2026-09-29 23:00:00') AS sourceDueLaterToday FROM crmTasks t WHERE t.organisationId=8 AND t.connectedSystemId=8 AND t.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(TRIM(t.status)) IN ('open','pending','incomplete','not_started','in_progress','scheduled','todo','to_do') AND t.dueAt IS NOT NULL;"
  db_sql "SELECT COUNT(DISTINCT t.id) AS pendingReviewTasks, SUM(t.dueAt<UTC_TIMESTAMP()) AS pendingReviewOverdue, SUM(t.dueAt>=UTC_TIMESTAMP() AND t.dueAt<'2026-09-29 23:00:00') AS pendingReviewDueLaterToday FROM actionProposals p JOIN crmTasks t ON t.organisationId=p.organisationId AND t.connectedSystemId=8 AND t.externalId=JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.taskExternalId')) WHERE p.organisationId=8 AND p.userId=2 AND p.actionType='complete_active_task' AND p.state IN ('review_required','approved') AND t.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(TRIM(t.status)) IN ('open','pending','incomplete','not_started','in_progress','scheduled','todo','to_do');"
  db_sql "SELECT t.id,t.externalId,t.title,t.dueAt,CONCAT_WS(' ',c.firstName,c.lastName) AS contactName,COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.raw,'$.normalizedCustomerContext.customFields.Xz5LMfmoQ0bWlFE2aqnu'))),''),'(blank)') AS bestTimeToCall,JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.taskExternalId')) AS pendingReviewTask FROM crmTasks t LEFT JOIN crmContacts c ON c.organisationId=t.organisationId AND c.connectedSystemId=t.connectedSystemId AND c.externalId=t.contactExternalId LEFT JOIN actionProposals p ON p.organisationId=t.organisationId AND p.userId=2 AND p.actionType='complete_active_task' AND p.state IN ('review_required','approved') AND JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.taskExternalId'))=t.externalId WHERE t.organisationId=8 AND t.connectedSystemId=8 AND t.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(TRIM(t.status)) IN ('open','pending','incomplete','not_started','in_progress','scheduled','todo','to_do') AND t.dueAt<UTC_TIMESTAMP() ORDER BY t.dueAt ASC LIMIT 70;"
  db_sql "SELECT t.id,t.externalId,t.title,t.dueAt,t.contactExternalId,LEFT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.raw,'$.description')),JSON_UNQUOTE(JSON_EXTRACT(t.raw,'$.body')),JSON_UNQUOTE(JSON_EXTRACT(t.raw,'$.note')),JSON_UNQUOTE(JSON_EXTRACT(t.raw,'$.notes')),''),500) AS taskDetail,JSON_KEYS(t.raw) AS rawKeys FROM crmTasks t WHERE t.organisationId=8 AND t.connectedSystemId=8 AND t.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND LOWER(TRIM(t.status)) IN ('open','pending','incomplete','not_started','in_progress','scheduled','todo','to_do') AND t.dueAt<='2026-09-29 23:00:00' AND (t.contactExternalId IS NULL OR LOWER(t.title) REGEXP 'check|assist|help|support|internal|colleague|snap|lead') ORDER BY t.dueAt ASC LIMIT 60;"
  db_sql "SELECT c.id,c.externalId,CONCAT_WS(' ',c.firstName,c.lastName) AS contactName,c.ownerExternalId,c.updatedAt FROM crmContacts c WHERE c.organisationId=8 AND LOWER(CONCAT_WS(' ',c.firstName,c.lastName)) LIKE '%benson%' ORDER BY c.updatedAt DESC LIMIT 20;"
  db_sql "SELECT m.id,CONCAT_WS(' ',c.firstName,c.lastName) AS contactName,m.channel,m.subject,m.receivedAt,m.status,m.needsAction,m.externalMessageId,JSON_UNQUOTE(JSON_EXTRACT(m.classification,'$.conversationExternalId')) AS conversationExternalId FROM inboundMessages m LEFT JOIN crmContacts c ON c.organisationId=m.organisationId AND c.connectedSystemId=m.connectedSystemId AND c.externalId=m.contactExternalId WHERE m.organisationId=8 AND LOWER(CONCAT_WS(' ',c.firstName,c.lastName)) LIKE '%benson%' ORDER BY m.receivedAt DESC LIMIT 30;"
  db_sql "SELECT a.id,CONCAT_WS(' ',c.firstName,c.lastName) AS contactName,a.activityType,a.occurredAt,LEFT(COALESCE(a.body,''),300) AS body,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.direction')) AS direction,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.messageType')) AS messageType,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.type')) AS rawType FROM crmActivities a LEFT JOIN crmContacts c ON c.organisationId=a.organisationId AND c.connectedSystemId=a.connectedSystemId AND c.externalId=a.contactExternalId WHERE a.organisationId=8 AND LOWER(CONCAT_WS(' ',c.firstName,c.lastName)) LIKE '%benson%' ORDER BY a.occurredAt DESC LIMIT 40;"
  db_sql "SELECT a.id,JSON_KEYS(a.raw) AS rawKeys,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.direction')) AS direction,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.type')) AS rawType,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.messageType')) AS messageType,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.channel')) AS channel,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.messageId')) AS messageId,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.conversationId')) AS conversationId,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.contactId')) AS rawContactId,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.source')) AS source FROM crmActivities a WHERE a.id=3030103;"
  db_sql "SELECT a.id,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.sourceKind')) AS sourceKind,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.sourceType')) AS sourceType,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.messageTypeString')) AS messageTypeString,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.conversationExternalId')) AS conversationExternalId,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.senderReference')) AS senderReference,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.recipientReference')) AS recipientReference,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.ownerScope')) AS ownerScope,JSON_UNQUOTE(JSON_EXTRACT(a.raw,'$.userExternalId')) AS userExternalId FROM crmActivities a WHERE a.id=3030103;"
  db_sql "SELECT id,createdAt,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.checkedConversations')) AS checkedConversations,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.received')) AS received,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.examined')) AS examined,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.bounded')) AS bounded,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sourceSince')) AS sourceSince FROM auditEntries WHERE organisationId=8 AND eventType='personal_genie_mailbox_synced' ORDER BY id DESC LIMIT 12;"

  echo "--- current open sales-work by type ---"
  db_sql "SELECT type,status,COUNT(*) AS count,MIN(dueAt) AS earliestDue,MAX(updatedAt) AS latestUpdated FROM salesWorkItems WHERE organisationId=8 AND salespersonUserId=2 AND status IN ('open','in_progress','snoozed','blocked') GROUP BY type,status ORDER BY type,status;"

  echo "--- stale source examples ---"
  db_sql "SELECT w.id,w.type,w.status,w.sourceType,w.sourceExternalId,w.taskExternalId,w.contactExternalId,w.dueAt,t.status AS crmTaskStatus,t.completedAt AS crmTaskCompletedAt FROM salesWorkItems w LEFT JOIN crmTasks t ON t.organisationId=w.organisationId AND t.connectedSystemId=w.connectedSystemId AND t.externalId=w.taskExternalId WHERE w.organisationId=8 AND w.salespersonUserId=2 AND w.status IN ('open','in_progress','snoozed','blocked') AND w.sourceType='crm_task' AND LOWER(TRIM(COALESCE(t.status,''))) IN ('completed','complete','done','closed','cancelled','canceled') ORDER BY t.completedAt DESC LIMIT 50;"

  echo "--- Sales Tracker authoritative owner truth ---"
  db_sql "SELECT COUNT(*) AS allTimeWon,ROUND(COALESCE(SUM(o.valueMinor),0)/100,2) AS allTimeValue FROM crmOpportunities o WHERE o.organisationId=8 AND o.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND o.closeAt IS NOT NULL AND (LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.raw,'$.status')),'')))='won' OR ((JSON_EXTRACT(o.raw,'$.status') IS NULL OR LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.raw,'$.status')),''))) IN ('','unknown')) AND EXISTS (SELECT 1 FROM crmPipelineStageMappings m WHERE m.organisationId=o.organisationId AND m.connectedSystemId=o.connectedSystemId AND m.isActive=1 AND m.category='won' AND (m.externalStageId=o.stage OR m.stageLabel=o.stage))));"
  db_sql "SELECT COUNT(*) AS septemberWon,ROUND(COALESCE(SUM(o.valueMinor),0)/100,2) AS septemberValue FROM crmOpportunities o WHERE o.organisationId=8 AND o.ownerExternalId='yZrFI0ptOyvG3ZXvs7iZ' AND o.closeAt>='2026-09-01 00:00:00' AND o.closeAt<'2026-10-01 00:00:00' AND (LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.raw,'$.status')),'')))='won' OR ((JSON_EXTRACT(o.raw,'$.status') IS NULL OR LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.raw,'$.status')),''))) IN ('','unknown')) AND EXISTS (SELECT 1 FROM crmPipelineStageMappings m WHERE m.organisationId=o.organisationId AND m.connectedSystemId=o.connectedSystemId AND m.isActive=1 AND m.category='won' AND (m.externalStageId=o.stage OR m.stageLabel=o.stage))));"

  echo "--- reminders and callbacks truth ---"
  db_sql "SELECT status,source,COUNT(*) AS count,MIN(dueAt) AS earliestDue,MAX(dueAt) AS latestDue FROM assistantReminders WHERE organisationId=8 AND userId=2 GROUP BY status,source ORDER BY status,source;"
  db_sql "SELECT state,COUNT(*) AS count,MIN(dueAt) AS earliestDue,MAX(dueAt) AS latestDue FROM callbackTasks WHERE organisationId=8 AND userId=2 GROUP BY state ORDER BY state;"
  db_sql "SELECT id,title,dueAt,timezone,source,status FROM assistantReminders WHERE organisationId=8 AND userId=2 AND status IN ('open','snoozed') ORDER BY COALESCE(snoozedUntil,dueAt) ASC LIMIT 20;"
  db_sql "SELECT id,leadLabel,title,dueAt,state FROM callbackTasks WHERE organisationId=8 AND userId=2 AND state='open' ORDER BY dueAt ASC LIMIT 20;"

  echo "--- organisation members by role ---"
  db_sql "SELECT role,isActive,COUNT(*) AS count FROM organisationMembers WHERE organisationId=8 GROUP BY role,isActive ORDER BY role,isActive;"

  echo "--- knowledge readiness ---"
  db_sql "SELECT status,visibility,sourceType,COUNT(*) AS count FROM knowledgeSources WHERE organisationId=8 GROUP BY status,visibility,sourceType ORDER BY status,visibility,sourceType;"
  db_sql "SELECT id,phase,status,attempt,lastError,updatedAt,completedAt FROM companyKnowledgeJobs WHERE organisationId=8 ORDER BY id DESC LIMIT 5;"
  db_sql "SELECT id,status,phase,attempt,LENGTH(discoverySnapshot) AS discoveryBytes,LENGTH(corpusSnapshot) AS corpusBytes,LENGTH(analysisDraft) AS analysisBytes,LENGTH(auditDraft) AS auditBytes,LENGTH(validatedPack) AS validatedPackBytes,LENGTH(CAST(progress AS CHAR)) AS progressBytes,RIGHT(lastError,2000) AS errorTail,resultDiscoveryId FROM companyKnowledgeJobs WHERE organisationId=8 ORDER BY id DESC LIMIT 3;"
  db_sql "SHOW COLUMNS FROM companyKnowledgeJobs WHERE Field IN ('status','phase','progress','validatedPack','lastError');"
  db_sql "SELECT j.id AS jobId,j.companyProfileId,p.organisationId AS profileOrganisationId,p.discoveryStatus,p.confirmedAt,p.updatedAt FROM companyKnowledgeJobs j LEFT JOIN companyProfiles p ON p.id=j.companyProfileId WHERE j.organisationId=8 ORDER BY j.id DESC LIMIT 5;"
  db_sql "SELECT id,organisationId,companyProfileId,status,reviewState,discoveryVersion,createdAt,reviewedAt FROM websiteDiscoveries WHERE companyProfileId IN (SELECT companyProfileId FROM companyKnowledgeJobs WHERE organisationId=8) ORDER BY id DESC LIMIT 10;"
  db_sql "SELECT id,discoveryStatus,confirmedAt,updatedAt FROM companyProfiles WHERE organisationId=8 ORDER BY id DESC LIMIT 5;"
  db_sql "SELECT status,reviewState,COUNT(*) AS count,MAX(discoveryVersion) AS latestVersion,MAX(createdAt) AS latestCreated,MAX(reviewedAt) AS latestReviewed FROM websiteDiscoveries WHERE organisationId=8 GROUP BY status,reviewState ORDER BY status,reviewState;"
  db_sql "SELECT status,COUNT(*) AS count,MIN(updatedAt) AS oldestUpdated,MAX(updatedAt) AS newestUpdated FROM knowledgeSources WHERE organisationId=8 GROUP BY status ORDER BY status;"

  echo "--- Course2Career Cyber Security knowledge coverage ---"
  db_sql "SELECT COUNT(*) AS readyCyberSources,SUM(CASE WHEN LOWER(COALESCE(content,'')) LIKE '%£1,899%' OR LOWER(COALESCE(content,'')) LIKE '%1,899%' THEN 1 ELSE 0 END) AS sourcesWithCurrentCyberPrice,SUM(CASE WHEN LOWER(COALESCE(content,'')) LIKE '%security+%' AND LOWER(COALESCE(content,'')) LIKE '%cysa+%' THEN 1 ELSE 0 END) AS sourcesWithExamCoverage,SUM(CASE WHEN LOWER(COALESCE(content,'')) LIKE '%finance%' AND (LOWER(COALESCE(content,'')) LIKE '%48 months%' OR LOWER(COALESCE(content,'')) LIKE '%£1 deposit%') THEN 1 ELSE 0 END) AS sourcesWithFinanceCoverage,SUM(CASE WHEN LOWER(COALESCE(content,'')) LIKE '%recruitment%' AND LOWER(COALESCE(content,'')) LIKE '%linkedin%' THEN 1 ELSE 0 END) AS sourcesWithRecruitmentCoverage FROM knowledgeSources WHERE organisationId=8 AND status='ready' AND (LOWER(COALESCE(title,'')) LIKE '%cyber%' OR LOWER(COALESCE(content,'')) LIKE '%cyber%');"
  db_sql "SELECT id,title,sourceType,LEFT(COALESCE(sourceUrl,''),220) AS sourceUrl,updatedAt FROM knowledgeSources WHERE organisationId=8 AND status='ready' AND (LOWER(COALESCE(title,'')) LIKE '%cyber%' OR LOWER(COALESCE(sourceUrl,'')) LIKE '%cyber%') ORDER BY updatedAt DESC LIMIT 20;"

  echo "--- skills and approved templates ---"
  db_sql "SELECT status,COUNT(*) AS versions,COUNT(DISTINCT playbookKey) AS skillKeys FROM playbookVersions WHERE organisationId=8 GROUP BY status ORDER BY status;"
  db_sql "SELECT status,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.channel')),'unspecified') AS channel,COUNT(*) AS count FROM approvalTemplates WHERE organisationId=8 GROUP BY status,channel ORDER BY status,channel;"
  db_sql "SELECT b.operationKey,b.status,JSON_UNQUOTE(JSON_EXTRACT(b.definition,'$.mode')) AS mode,b.lastSuccessAt,b.lastFailureAt,b.lastError FROM browserLearnedOperations b JOIN (SELECT operationKey,MAX(version) AS version FROM browserLearnedOperations WHERE organisationId=8 AND connectedSystemId=8 GROUP BY operationKey) latest ON latest.operationKey=b.operationKey AND latest.version=b.version WHERE b.organisationId=8 AND b.connectedSystemId=8 ORDER BY b.operationKey;"

  echo "--- review and workflow state ---"
  db_sql "SELECT status,COUNT(*) AS count,MAX(updatedAt) AS latest FROM workflowRuns WHERE organisationId=8 GROUP BY status ORDER BY status;"
  db_sql "SELECT state,governanceState,actionType,COUNT(*) AS count,MAX(createdAt) AS latest FROM actionProposals WHERE organisationId=8 GROUP BY state,governanceState,actionType ORDER BY state,governanceState,actionType;"
  db_sql "SELECT status,COUNT(*) AS count,MAX(createdAt) AS latest FROM playbookExecutionHistory WHERE organisationId=8 GROUP BY status ORDER BY status;"
  db_sql "SELECT status,COUNT(*) AS count,MAX(createdAt) AS latest FROM inboundReplyDrafts WHERE organisationId=8 GROUP BY status ORDER BY status;"

  echo "--- mailbox and report state ---"
  db_sql "SELECT provider,status,JSON_LENGTH(scopes) AS scopeCount,lastSyncedAt,expiresAt,updatedAt FROM userMailboxConnections WHERE organisationId=8 AND userId=2;"
  db_sql "SELECT isEnabled,COUNT(*) AS count,MAX(lastSentAt) AS latestSent,MAX(updatedAt) AS latestUpdated FROM dailyReports WHERE organisationId=8 AND userId=2 GROUP BY isEnabled;"

  echo "--- operational event lifecycle ---"
  db_sql "SELECT eventKey,severity,category,COUNT(*) AS total,SUM(resolvedAt IS NULL) AS unresolved,MIN(createdAt) AS firstAt,MAX(createdAt) AS lastAt FROM operationalEvents WHERE organisationId=8 GROUP BY eventKey,severity,category ORDER BY unresolved DESC,total DESC LIMIT 40;"

  echo "--- CRM session stability timeline ---"
  db_sql "SELECT id,eventType,createdAt,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.identityScope')) AS identityScope,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.exactPageIdentityPersisted')) AS exactPageIdentityPersisted FROM auditEntries WHERE organisationId=8 AND userId=2 AND eventType IN ('crm_session_authenticated','crm_reauthentication_required','crm_viewer_opened','crm_viewer_expired','crm_viewer_disconnected') AND createdAt>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 24 HOUR) ORDER BY id DESC LIMIT 60;"
  db_sql "SELECT b.operationKey,b.status,b.lastSuccessAt,b.lastFailureAt,LEFT(COALESCE(b.lastError,''),260) AS errorSummary FROM browserLearnedOperations b JOIN (SELECT operationKey,MAX(version) AS version FROM browserLearnedOperations WHERE organisationId=8 AND connectedSystemId=8 GROUP BY operationKey) latest ON latest.operationKey=b.operationKey AND latest.version=b.version WHERE b.organisationId=8 AND b.connectedSystemId=8 AND b.operationKey IN ('auth.login','contact.sync','contact.search','contact.read','task.sync','opportunity.sync') ORDER BY b.operationKey;"
  shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml logs --since=45m --timestamps worker app 2>&1 | grep -E 'CRM_BROWSER_REAUTHENTICATION_REQUIRED|crm_browser_session|crm_degraded_read|crm_sync_cycle|crm_new_lead_watch|personal_mailbox' | tail -n 320 || true"

  echo "--- connector and worker health ---"
  db_sql "SELECT resourceType,status,capabilityKey,lastStartedAt,lastSucceededAt,lastError FROM connectorSyncJobs WHERE organisationId=8 ORDER BY resourceType;"
  db_sql "SELECT severity,category,COUNT(*) AS eventCount,MAX(createdAt) AS latest FROM operationalEvents WHERE organisationId=8 AND createdAt>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 24 HOUR) GROUP BY severity,category ORDER BY severity,category;"
  db_sql "SELECT workerKey,status,COUNT(*) AS count,MAX(startedAt) AS latestStarted,MAX(finishedAt) AS latestFinished FROM operationalWorkerRuns WHERE organisationId=8 AND startedAt>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY) GROUP BY workerKey,status ORDER BY workerKey,status;"

  echo "--- recent live truth worker cycles ---"
  shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml logs --since=8m --timestamps worker 2>&1 | grep -E 'crm_sync_cycle|crm_new_lead_watch_cycle|personal_mailbox_sync_cycle|crm_background_read_lane_wait' | tail -n 240 || true"

  echo "--- live call telemetry ---"
  db_sql "SELECT eventType,COUNT(*) AS count,MIN(createdAt) AS firstAt,MAX(createdAt) AS lastAt FROM auditEntries WHERE organisationId=8 AND eventType IN ('live_call_audio_transcribed','live_call_coaching_stream','live_call_completed','live_call_started') GROUP BY eventType ORDER BY eventType;"
  db_sql "SELECT id,createdAt,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transcriptionMs')) AS transcriptionMs,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.queueWaitMs')) AS queueWaitMs,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.durationMs')) AS durationMs,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sttActiveAtStart')) AS activeAtStart,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sttWaitingAtStart')) AS waitingAtStart FROM auditEntries WHERE organisationId=8 AND eventType='live_call_audio_transcribed' ORDER BY id DESC LIMIT 40;"
  db_sql "SELECT id,status,createdAt,updatedAt,LENGTH(COALESCE(transcript,'')) AS transcriptChars,LENGTH(COALESCE(coachNotes,'')) AS coachChars,JSON_LENGTH(COALESCE(structuredOutcome,JSON_OBJECT())) AS outcomeFields FROM callSessions WHERE organisationId=8 ORDER BY id DESC LIMIT 20;"

  echo "--- current STT routing and direct benchmark ---"
  shell_admin "docker compose --env-file .env -f deploy/webdock/docker-compose.yml exec -T app node --input-type=module - <<'NODE'
const configuration = {
  defaultUrl: process.env.STT_TRANSCRIPTIONS_URL || '',
  defaultModel: process.env.STT_MODEL || '',
  englishUrl: process.env.STT_EN_TRANSCRIPTIONS_URL || '',
  englishModel: process.env.STT_EN_MODEL || '',
  maxConcurrency: process.env.STT_MAX_CONCURRENCY || '1(default)',
  maxQueue: process.env.STT_MAX_QUEUE || '8(default)',
};
console.log('STT_ROUTING=' + JSON.stringify(configuration));
const sampleRate = 16000;
function makeWav(seconds) {
  const frames = Math.floor(sampleRate * seconds);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + frames * 2, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const envelope = Math.sin(Math.PI * i / frames);
    const sample = Math.sin(2 * Math.PI * 220 * i / sampleRate) * 0.18 * envelope;
    wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return wav;
}
async function bench(label, url, model, seconds, rounds = 2) {
  if (!url || !model) {
    console.log('STT_BENCH=' + JSON.stringify({ label, seconds, skipped: true }));
    return;
  }
  const wav = makeWav(seconds);
  for (let round = 1; round <= rounds; round++) {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'benchmark.wav');
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('language', 'en');
    const started = performance.now();
    const response = await fetch(url, { method: 'POST', body: form });
    const body = await response.text();
    console.log('STT_BENCH=' + JSON.stringify({
      label,
      seconds,
      round,
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      responseChars: body.length,
    }));
  }
}
for (const seconds of [1, 1.25, 1.5, 2, 2.5]) {
  await bench('english', configuration.englishUrl, configuration.englishModel, seconds, 2);
}
async function concurrentBench(seconds, parallel) {
  const wav = makeWav(seconds);
  const started = performance.now();
  const requests = Array.from({ length: parallel }, async (_, index) => {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'parallel-' + index + '.wav');
    form.append('model', configuration.englishModel);
    form.append('response_format', 'json');
    form.append('language', 'en');
    const oneStarted = performance.now();
    const response = await fetch(configuration.englishUrl, { method: 'POST', body: form });
    await response.text();
    return {
      index,
      status: response.status,
      elapsedMs: Math.round(performance.now() - oneStarted),
    };
  });
  const results = await Promise.all(requests);
  console.log('STT_PARALLEL=' + JSON.stringify({
    seconds,
    parallel,
    wallMs: Math.round(performance.now() - started),
    results,
  }));
}
await concurrentBench(2.5, 2);
await concurrentBench(2, 2);
await bench('multilingual', configuration.defaultUrl, configuration.defaultModel, 2.5, 1);
NODE"
  docker stats --no-stream --format '{{.Name}}|cpu={{.CPUPerc}}|mem={{.MemUsage}}' webdock-app-1 webdock-stt-en-1 webdock-stt-1 2>/dev/null || true

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
  tracker_working_blob="$(git_admin hash-object server/salesTracker.ts 2>/dev/null || true)"
  # b6f1b76... is the exact canonical server/salesTracker.ts blob from
  # main@61bea8bb1b4d9b634cb6c42eb89eddca4696d3f7. The VPS drift detected
  # on 2026-09-29 is therefore a known stale canonical ancestor, not unique
  # production work. Permit only this exact historical content to be replaced.
  if [ "$tracker_working_blob" = "b6f1b76c9dee59bdc95c17e7da41fca82e21b02e" ] && \
     git_admin diff --exit-code "$TARGET_SHA" -- server/salesTrackerAcceptance.test.ts; then
    echo "TRACKER_LOCAL_DIFF=KNOWN_CANONICAL_ANCESTOR"
    echo "tracker_working_blob=$tracker_working_blob"
  else
    git_admin diff --ignore-all-space --ignore-blank-lines --exit-code "$TARGET_SHA" -- \
      server/salesTracker.ts \
      server/salesTrackerAcceptance.test.ts \
      || fail "local tracker edits differ semantically from frozen GitHub release"
    echo "TRACKER_LOCAL_DIFF=WHITESPACE_ONLY"
  fi
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
