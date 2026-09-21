import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  connectedSystems,
  crmSyncCursors,
  externalUserMappings,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  getConnectedSystemForUser,
  loadUserConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";
import { getCrmAdapter } from "./adapterRegistry";
import { connectedSystemHasActiveCommissioning } from "./backgroundReadCommissioningGuard";
import { assertPersonalBrowserOwnerScope } from "./personalOwnerScope";
import {
  existingContactIds,
  reconcileNewLeadAlertsFromTaskHistory,
  refreshActiveCustomerSourceTruth,
  upsertContacts,
} from "./sync";
import { upsertSalesWorkFromCrm } from "../salesWork";
import { isTransientBrowserExecutionFailure } from "../browserConnectors/runtimeFailure";

export const DEFAULT_NEW_LEAD_POLL_INTERVAL_MS = 60_000;

export function newLeadPollIntervalMs(
  raw = process.env.NEW_LEAD_POLL_INTERVAL_MS
) {
  const parsed = Number(raw || DEFAULT_NEW_LEAD_POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= DEFAULT_NEW_LEAD_POLL_INTERVAL_MS
    ? Math.floor(parsed)
    : DEFAULT_NEW_LEAD_POLL_INTERVAL_MS;
}
async function synchronizationUsers(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const mapped = await db
    .select({
      userId: externalUserMappings.userId,
      mappingEmail: externalUserMappings.email,
      userEmail: users.email,
    })
    .from(externalUserMappings)
    .innerJoin(users, eq(users.id, externalUserMappings.userId))
    .where(
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(externalUserMappings.connectedSystemId, input.connectedSystemId),
        eq(externalUserMappings.isActive, true),
        isNotNull(externalUserMappings.userId)
      )
    );
  return Array.from(
    new Set(
      mapped
        .filter(row => {
          const mappedEmail = row.mappingEmail?.trim().toLowerCase();
          const userEmail = row.userEmail?.trim().toLowerCase();
          return Boolean(row.userId && mappedEmail && mappedEmail === userEmail);
        })
        .map(row => Number(row.userId))
    )
  );
}
async function contactsBaselineComplete(connectedSystemId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (
    await db
      .select({ lastSuccessfulAt: crmSyncCursors.lastSuccessfulAt })
      .from(crmSyncCursors)
      .where(
        and(
          eq(crmSyncCursors.connectedSystemId, connectedSystemId),
          eq(crmSyncCursors.resourceType, "contacts")
        )
      )
      .limit(1)
  )[0];
  return Boolean(row?.lastSuccessfulAt);
}

export function leadWatchFailureIsDeferral(error: unknown) {
  if (isTransientBrowserExecutionFailure(error)) return true;
  const detail = error instanceof Error ? error.message : String(error);
  return /CRM_VIEWER_AGENT_CONTROL_ACTIVE|BROWSER_CONTROL|lease|busy/i.test(detail);
}

export async function runNewLeadWatchCycle(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = await db
    .select()
    .from(connectedSystems)
    .where(inArray(connectedSystems.status, ["ready", "limited_permissions"]))
    .orderBy(asc(connectedSystems.id));

  let checked = 0;
  let latestPageRecords = 0;
  let newLeads = 0;
  let workedLeadsRetired = 0;
  let taskCompletedLeadsRetired = 0;
  let historyChecked = 0;
  let deferred = 0;
  let failed = 0;
  for (const system of systems) {
    if (
      await connectedSystemHasActiveCommissioning({
        organisationId: system.organisationId,
        connectedSystemId: system.id,
      })
    )
      continue;

    const usersForSystem = await synchronizationUsers({
      organisationId: system.organisationId,
      connectedSystemId: system.id,
    });
    for (const userId of usersForSystem) {
      checked += 1;
      try {
        const current = await getConnectedSystemForUser(
          userId,
          system.organisationId,
          system.id
        );
        const connection = toAdapterConnection(current);
        const adapter = getCrmAdapter(connection.provider);
        if (!adapter.syncRecentContacts) continue;
        const secret = await loadUserConnectionSecret({
          userId,
          organisationId: system.organisationId,
          connectedSystemId: system.id,
          secretKind: "browser",
        });
        if (!secret?.crmUserExternalId)
          throw new Error("CRM_SALESPERSON_IDENTITY_REQUIRED");

        const page = await adapter.syncRecentContacts({ connection, secret });
        assertPersonalBrowserOwnerScope({
          resourceType: "contacts",
          expectedOwnerExternalId: secret.crmUserExternalId,
          records: page.records,
        });
        latestPageRecords += page.records.length;
        const existingExternalIds = await existingContactIds(
          system.organisationId,
          system.id,
          page.records.map(record => record.externalId)
        );
        const baselineComplete = await contactsBaselineComplete(system.id);
        await upsertContacts(system.organisationId, system.id, page.records);
        const candidates = await upsertSalesWorkFromCrm({
          organisationId: system.organisationId,
          connectedSystemId: system.id,
          resource: { type: "contacts", records: page.records },
          now,
          contactBaseline: { baselineComplete, existingExternalIds },
        });
        newLeads += candidates.filter(candidate => candidate.type === "NEW_LEAD").length;

        const taskReconciliation =
          await reconcileNewLeadAlertsFromTaskHistory({
            userId,
            organisationId: system.organisationId,
            connectedSystemId: system.id,
          });
        taskCompletedLeadsRetired += taskReconciliation;

        const historyReconciliation =
          await refreshActiveCustomerSourceTruth({
            userId,
            organisationId: system.organisationId,
            connectedSystemId: system.id,
            adapter,
            connection,
            secret,
            now,
          });
        historyChecked += historyReconciliation.checked;
        workedLeadsRetired += historyReconciliation.resolvedNewLeads;
      } catch (error) {
        if (leadWatchFailureIsDeferral(error)) {
          deferred += 1;
          continue;
        }
        failed += 1;
        console.error(
          JSON.stringify({
            event: "crm_new_lead_watch_failed",
            connectedSystemId: system.id,
            detail:
              error instanceof Error
                ? error.message.slice(0, 500)
                : String(error).slice(0, 500),
          })
        );
      }
    }
  }

  return {
    checked,
    latestPageRecords,
    newLeads,
    historyChecked,
    workedLeadsRetired,
    taskCompletedLeadsRetired,
    deferred,
    failed,
  };
}
export function startNewLeadWatcher(
  intervalMs = newLeadPollIntervalMs(),
  runCycle: () => Promise<unknown> = () => runNewLeadWatchCycle()
) {
  const safeInterval = Math.max(DEFAULT_NEW_LEAD_POLL_INTERVAL_MS, intervalMs);
  let processing = false;
  const run = async () => {
    if (processing) return false;
    processing = true;
    try {
      const result = await runCycle();
      if (result && typeof result === "object")
        console.log(JSON.stringify({ event: "crm_new_lead_watch_cycle", ...result }));
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "crm_new_lead_watch_cycle_failed",
          detail:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        })
      );
      return false;
    } finally {
      processing = false;
    }
  };
  void run();
  return { timer: setInterval(() => void run(), safeInterval), run };
}
