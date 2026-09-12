import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  connectedSystems,
  connectorSyncJobs,
  externalUserMappings,
  organisationMembers,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { runModelFreeOperation } from "../aiExecutionBoundary";
import { syncConnectedSystem } from "./sync";

export const DEFAULT_CRM_SYNC_INTERVAL_MS = 120_000;
const MAX_CONNECTIONS_PER_CYCLE = 50;
export const CRM_SYNC_STALE_LEASE_MS = 10 * 60_000;

export function crmSyncIntervalMs(raw = process.env.CRM_SYNC_INTERVAL_MS) {
  const parsed = Number(raw || DEFAULT_CRM_SYNC_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 30_000
    ? Math.floor(parsed)
    : DEFAULT_CRM_SYNC_INTERVAL_MS;
}

export function crmSyncJobIsDue(
  lastStartedAt: Date | null,
  now: Date,
  intervalMs = crmSyncIntervalMs()
) {
  return (
    !lastStartedAt || now.valueOf() - lastStartedAt.valueOf() >= intervalMs
  );
}

export async function ensureConnectionScopedCrmSyncJob(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db
    .insert(connectorSyncJobs)
    .values({
      ...input,
      resourceType: "crm_reconciliation",
      scheduleExpression: `every:${crmSyncIntervalMs()}ms`,
      status: "ready",
      capabilityKey: "crm.sync",
    })
    .onDuplicateKeyUpdate({
      set: {
        scheduleExpression: `every:${crmSyncIntervalMs()}ms`,
        capabilityKey: "crm.sync",
      },
    });
}

async function synchronizationUsers(input: {
  organisationId: number;
  connectedSystemId: number;
  connectionMethod: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  if (["browser", "sidecar"].includes(input.connectionMethod)) {
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
            const mappingEmail = row.mappingEmail?.trim().toLowerCase();
            const userEmail = row.userEmail?.trim().toLowerCase();
            return Boolean(
              row.userId &&
                mappingEmail &&
                userEmail &&
                mappingEmail === userEmail
            );
          })
          .map(row => Number(row.userId))
      )
    );
  }
  const member = (
    await db
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, input.organisationId),
          eq(organisationMembers.isActive, true)
        )
      )
      .orderBy(asc(organisationMembers.id))
      .limit(1)
  )[0];
  return member ? [member.userId] : [];
}

/** One bounded reconciliation cycle. Each connection retains independent failure state. */
export async function runConnectionScopedCrmSyncCycle(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = await db
    .select()
    .from(connectedSystems)
    .where(inArray(connectedSystems.status, ["ready", "limited_permissions"]));

  for (const system of systems)
    await ensureConnectionScopedCrmSyncJob({
      organisationId: system.organisationId,
      connectedSystemId: system.id,
    });

  const dueBefore = new Date(now.valueOf() - crmSyncIntervalMs());
  const staleBefore = new Date(now.valueOf() - CRM_SYNC_STALE_LEASE_MS);
  const rows = await db
    .select({ job: connectorSyncJobs, system: connectedSystems })
    .from(connectorSyncJobs)
    .innerJoin(
      connectedSystems,
      eq(connectorSyncJobs.connectedSystemId, connectedSystems.id)
    )
    .where(
      and(
        eq(connectorSyncJobs.resourceType, "crm_reconciliation"),
        or(
          and(
            inArray(connectorSyncJobs.status, ["ready", "error"]),
            or(
              isNull(connectorSyncJobs.lastStartedAt),
              lt(connectorSyncJobs.lastStartedAt, dueBefore)
            )
          ),
          and(
            eq(connectorSyncJobs.status, "running"),
            or(
              isNull(connectorSyncJobs.lastStartedAt),
              lt(connectorSyncJobs.lastStartedAt, staleBefore)
            )
          )
        ),
        inArray(connectedSystems.status, ["ready", "limited_permissions"])
      )
    )
    .orderBy(asc(connectorSyncJobs.lastStartedAt), asc(connectorSyncJobs.id))
    .limit(MAX_CONNECTIONS_PER_CYCLE);

  let synchronized = 0;
  let failed = 0;
  for (const row of rows) {
    const claim = await db
      .update(connectorSyncJobs)
      .set({ status: "running", lastStartedAt: now, lastError: null })
      .where(
        and(
          eq(connectorSyncJobs.id, row.job.id),
          or(
            inArray(connectorSyncJobs.status, ["ready", "error"]),
            and(
              eq(connectorSyncJobs.status, "running"),
              or(
                isNull(connectorSyncJobs.lastStartedAt),
                lt(connectorSyncJobs.lastStartedAt, staleBefore)
              )
            )
          )
        )
      );
    if (Number(claim[0].affectedRows || 0) !== 1) continue;
    try {
      const userIds = await synchronizationUsers({
        organisationId: row.system.organisationId,
        connectedSystemId: row.system.id,
        connectionMethod: row.system.connectionMethod,
      });
      for (const userId of userIds)
        await syncConnectedSystem({
          userId,
          organisationId: row.system.organisationId,
          connectedSystemId: row.system.id,
        });
      if (userIds.length) synchronized += 1;
      await db
        .update(connectorSyncJobs)
        .set({ status: "ready", lastSucceededAt: new Date(), lastError: null })
        .where(eq(connectorSyncJobs.id, row.job.id));
    } catch (error) {
      failed += 1;
      await db
        .update(connectorSyncJobs)
        .set({
          status: "error",
          lastError:
            error instanceof Error
              ? error.message.slice(0, 2_000)
              : String(error).slice(0, 2_000),
        })
        .where(eq(connectorSyncJobs.id, row.job.id));
    }
  }
  return {
    checked: rows.length,
    synchronized,
    failed,
    modelUsed: false as const,
    providerCallCount: 0 as const,
  };
}

export function startConnectionScopedCrmSyncWorker(
  intervalMs = crmSyncIntervalMs()
) {
  let processing = false;
  const run = async () => {
    if (processing) return;
    processing = true;
    try {
      const result = await runModelFreeOperation(
        { purpose: "crm_sync", reference: `crm-sync-cycle:${Date.now()}` },
        () => runConnectionScopedCrmSyncCycle()
      );
      if (result.value.checked || result.value.failed)
        console.log(
          JSON.stringify({ event: "crm_sync_cycle", ...result.value })
        );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "crm_sync_cycle_failed",
          detail:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        })
      );
    } finally {
      processing = false;
    }
  };
  void run();
  return setInterval(() => void run(), intervalMs);
}
