import { and, asc, eq, inArray } from "drizzle-orm";
import {
  connectedSystems,
  connectorSyncJobs,
  organisationMembers,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { loadConnectionSecret } from "../connectedSystems";
import { runModelFreeOperation } from "../aiExecutionBoundary";
import { syncConnectedSystem } from "./sync";

export const DEFAULT_CRM_SYNC_INTERVAL_MS = 120_000;
const MAX_CONNECTIONS_PER_CYCLE = 50;

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

async function synchronizationUser(input: {
  organisationId: number;
  connectedSystemId: number;
  connectionMethod: string;
}) {
  if (["browser", "sidecar"].includes(input.connectionMethod)) {
    const marker = await loadConnectionSecret({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      secretKind: "browser",
    });
    const userId = Number(marker?.commissioningUserId || 0);
    if (userId) return userId;
  }
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
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
  if (!member)
    throw new Error(
      "No active organisation member can run CRM synchronization."
    );
  return member.userId;
}

/** One bounded reconciliation cycle. Each connection retains independent failure state. */
export async function runConnectionScopedCrmSyncCycle(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = await db
    .select()
    .from(connectedSystems)
    .where(inArray(connectedSystems.status, ["ready", "limited_permissions"]))
    .limit(MAX_CONNECTIONS_PER_CYCLE);

  for (const system of systems)
    await ensureConnectionScopedCrmSyncJob({
      organisationId: system.organisationId,
      connectedSystemId: system.id,
    });

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
        inArray(connectorSyncJobs.status, ["ready", "error", "running"]),
        inArray(connectedSystems.status, ["ready", "limited_permissions"])
      )
    )
    .limit(MAX_CONNECTIONS_PER_CYCLE);

  let synchronized = 0;
  let failed = 0;
  for (const row of rows) {
    if (!crmSyncJobIsDue(row.job.lastStartedAt, now)) continue;
    await db
      .update(connectorSyncJobs)
      .set({ status: "running", lastStartedAt: now, lastError: null })
      .where(eq(connectorSyncJobs.id, row.job.id));
    try {
      const userId = await synchronizationUser({
        organisationId: row.system.organisationId,
        connectedSystemId: row.system.id,
        connectionMethod: row.system.connectionMethod,
      });
      await syncConnectedSystem({
        userId,
        organisationId: row.system.organisationId,
        connectedSystemId: row.system.id,
      });
      synchronized += 1;
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
