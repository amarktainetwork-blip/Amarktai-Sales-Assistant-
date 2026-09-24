import {
  isTransientCrmSyncFailure,
  reconcileNewLeadAlertsFromTaskHistory,
} from "./sync";
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
import { connectedSystemHasActiveCommissioning } from "./backgroundReadCommissioningGuard";
import { syncConnectedSystem, syncConnectedSystemRoutine } from "./sync";
import { getCrmAdapter } from "./adapterRegistry";
import {
  loadUserConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";

export const DEFAULT_CRM_SYNC_INTERVAL_MS = 120_000;
export const CRM_SYNC_POLL_INTERVAL_MS = 30_000;
export const BACKGROUND_ROUTINE_REFRESH_CUSTOMER_HISTORY = false;
const MAX_CONNECTIONS_PER_CYCLE = 50;
export const CRM_SYNC_STALE_LEASE_MS = 10 * 60_000;

export function crmSyncIntervalMs(raw = process.env.CRM_SYNC_INTERVAL_MS) {
  const parsed = Number(raw || DEFAULT_CRM_SYNC_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 30_000
    ? Math.floor(parsed)
    : DEFAULT_CRM_SYNC_INTERVAL_MS;
}

export function crmBackgroundSyncMode(connectionMethod: string) {
  return ["browser", "sidecar"].includes(connectionMethod)
    ? ("routine" as const)
    : ("full" as const);
}

export function shouldAttemptReadOnlyAuthenticationRecovery(input: {
  status: string;
  connectionMethod: string;
  lastHealthCheckAt: Date | null;
  now: Date;
  intervalMs?: number;
}) {
  if (
    input.status !== "authentication_expired" ||
    !["browser", "sidecar"].includes(input.connectionMethod)
  )
    return false;
  const intervalMs = input.intervalMs ?? crmSyncIntervalMs();
  return (
    !input.lastHealthCheckAt ||
    input.now.valueOf() - input.lastHealthCheckAt.valueOf() >= intervalMs
  );
}

export function crmSyncJobIsDue(
  lastStartedAt: Date | null,
  now: Date,
  intervalMs = crmSyncIntervalMs(),
  lastSucceededAt: Date | null = null
) {
  return (
    (!lastStartedAt || now.valueOf() - lastStartedAt.valueOf() >= intervalMs) &&
    (!lastSucceededAt ||
      now.valueOf() - lastSucceededAt.valueOf() >= intervalMs)
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

async function attemptReadOnlyAuthenticationRecovery(input: {
  system: typeof connectedSystems.$inferSelect;
  userId: number;
  now: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const connection = toAdapterConnection(input.system);
  const adapter = getCrmAdapter(connection.provider);
  if (!adapter.reproveRecentContactsRead) return false;
  const secret = await loadUserConnectionSecret({
    userId: input.userId,
    organisationId: input.system.organisationId,
    connectedSystemId: input.system.id,
    secretKind: "browser",
  });
  if (
    !secret?.browserSession ||
    !secret.crmUserExternalId ||
    secret.browserUserId !== input.userId
  )
    return false;

  try {
    // This is deliberately a GET-only, exact-owner re-proof. The adapter fixes
    // the operation to contact.sync, enables failed-read verification only, and
    // publishes fresh structured read proof for this exact mapped browser user.
    // No CRM write capability is required or exercised.
    await adapter.reproveRecentContactsRead({
      connection,
      secret,
      publishByUserId: input.userId,
    });
    const [restored] = await db
      .select({ status: connectedSystems.status })
      .from(connectedSystems)
      .where(eq(connectedSystems.id, input.system.id))
      .limit(1);
    const recovered = Boolean(
      restored && ["ready", "limited_permissions"].includes(restored.status)
    );
    if (recovered)
      console.log(
        JSON.stringify({
          event: "crm_read_authentication_recovered",
          connectedSystemId: input.system.id,
          userId: input.userId,
          externalWritePerformed: false,
        })
      );
    return recovered;
  } catch (error) {
    await db
      .update(connectedSystems)
      .set({ lastHealthCheckAt: input.now })
      .where(eq(connectedSystems.id, input.system.id));
    console.warn(
      JSON.stringify({
        event: "crm_read_authentication_recovery_deferred",
        connectedSystemId: input.system.id,
        userId: input.userId,
        detail:
          error instanceof Error
            ? error.message.slice(0, 300)
            : String(error).slice(0, 300),
        externalWritePerformed: false,
      })
    );
    return false;
  }
}

/** One bounded reconciliation cycle. Each connection retains independent failure state. */
export async function runConnectionScopedCrmSyncCycle(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const candidateSystems = await db
    .select()
    .from(connectedSystems)
    .where(
      inArray(connectedSystems.status, [
        "ready",
        "limited_permissions",
        "authentication_expired",
        "testing",
      ])
    );

  for (const system of candidateSystems) {
    if (!["browser", "sidecar"].includes(system.connectionMethod)) continue;
    try {
      const userIds = await synchronizationUsers({
        organisationId: system.organisationId,
        connectedSystemId: system.id,
        connectionMethod: system.connectionMethod,
      });
      for (const userId of userIds)
        await reconcileNewLeadAlertsFromTaskHistory({
          userId,
          organisationId: system.organisationId,
          connectedSystemId: system.id,
        });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "crm_cached_work_reconciliation_failed",
          connectedSystemId: system.id,
          detail:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        })
      );
    }
  }

  for (const system of candidateSystems) {
    if (
      !shouldAttemptReadOnlyAuthenticationRecovery({
        status: system.status,
        connectionMethod: system.connectionMethod,
        lastHealthCheckAt: system.lastHealthCheckAt,
        now,
      })
    )
      continue;
    const userIds = await synchronizationUsers({
      organisationId: system.organisationId,
      connectedSystemId: system.id,
      connectionMethod: system.connectionMethod,
    });
    for (const userId of userIds) {
      if (
        await attemptReadOnlyAuthenticationRecovery({
          system,
          userId,
          now,
        })
      )
        break;
    }
  }

  // Re-read after recovery so a restored browser connection can enter normal
  // reconciliation in the same cycle instead of waiting for another poll.
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
            ),
            or(
              isNull(connectorSyncJobs.lastSucceededAt),
              lt(connectorSyncJobs.lastSucceededAt, dueBefore)
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
    if (
      await connectedSystemHasActiveCommissioning({
        organisationId: row.system.organisationId,
        connectedSystemId: row.system.id,
      })
    )
      continue;

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
      const routine =
        crmBackgroundSyncMode(row.system.connectionMethod) === "routine";
      for (const userId of userIds) {
        const syncInput = {
          userId,
          organisationId: row.system.organisationId,
          connectedSystemId: row.system.id,
        };
        if (routine)
          await syncConnectedSystemRoutine({
            ...syncInput,
            // The 60-second lead watcher owns exact active-customer history.
            // Avoid duplicating those expensive browser reads in reconciliation.
            refreshCustomerHistory:
              BACKGROUND_ROUTINE_REFRESH_CUSTOMER_HISTORY,
          });
        else await syncConnectedSystem(syncInput);
      }
      if (userIds.length) synchronized += 1;
      await db
        .update(connectorSyncJobs)
        .set({ status: "ready", lastSucceededAt: new Date(), lastError: null })
        .where(eq(connectorSyncJobs.id, row.job.id));
    } catch (error) {
      if (isTransientCrmSyncFailure(error)) {
        await db
          .update(connectorSyncJobs)
          .set({
            status: row.job.status === "error" ? "error" : "ready",
            lastStartedAt: null,
          })
          .where(eq(connectorSyncJobs.id, row.job.id));
        continue;
      }
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
  intervalMs = crmSyncIntervalMs(),
  runCycle: () => Promise<Awaited<ReturnType<typeof runConnectionScopedCrmSyncCycle>>> =
    runConnectionScopedCrmSyncCycle
) {
  let processing = false;
  const run = async () => {
    if (processing) return;
    processing = true;
    try {
      const result = await runModelFreeOperation(
        { purpose: "crm_sync", reference: `crm-sync-cycle:${Date.now()}` },
        () => runCycle()
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
  return setInterval(
    () => void run(),
    Math.min(intervalMs, CRM_SYNC_POLL_INTERVAL_MS)
  );
}
