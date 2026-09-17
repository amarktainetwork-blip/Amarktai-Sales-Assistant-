import { and, desc, eq } from "drizzle-orm";
import {
  browserLearnedOperations,
  connectedSystems,
  crmCommissioningJobs,
  crmSyncCursors,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { BROWSER_CAPABILITY_REQUIREMENTS } from "../browserConnectors/operationContracts";
import { effectiveLatestBrowserOperation } from "../browserConnectors/learnedOperations";
import { isTransientBrowserExecutionFailure } from "../browserConnectors/runtimeFailure";
import { accountBrowserCapabilities } from "./capabilityAccounting";

/**
 * Only resources materialised by the canonical personal browser sync require
 * durable cursors. Opportunities and activities are safe-read capabilities in
 * this mode: LIVE_PROVEN operation evidence is their current truth.
 */
const cursorBackedResources: Record<string, string> = {
  "companies.read": "companies",
  "contacts.read": "contacts",
  "tasks.read": "tasks",
};
export function calculateCurrentReadiness(input: {
  operations: ReadonlyMap<string, string>;
  allowedReads: string[];
  allowedWrites: string[];
  discovered: string[];
  cursors: Array<{
    resourceType: string;
    lastSuccessfulAt: Date | null;
    lastError: string | null;
  }>;
}) {
  const proven = Array.from(input.operations)
    .filter(([, status]) => status === "LIVE_PROVEN")
    .map(([key]) => key);
  const verifiedCapabilities = [
    ...input.allowedReads,
    ...input.allowedWrites,
  ].filter(capability => {
    const required = BROWSER_CAPABILITY_REQUIREMENTS[capability];
    return (
      required?.length &&
      required.every(key => input.operations.get(key) === "LIVE_PROVEN")
    );
  });
  const capabilityAccounting = accountBrowserCapabilities({
    operationStatuses: input.operations,
    discoveredOperationKeys: input.discovered,
    allowedReadCapabilities: input.allowedReads,
    allowedWriteCapabilities: input.allowedWrites,
  });
  const requiredResources = input.allowedReads
    .map(key => cursorBackedResources[key])
    .filter(Boolean);
  const blockingResources = requiredResources.filter(resource => {
    const cursor = input.cursors.find(row => row.resourceType === resource);
    return (
      !cursor?.lastSuccessfulAt ||
      Boolean(
        cursor.lastError &&
          !isTransientBrowserExecutionFailure(cursor.lastError)
      )
    );
  });
  const ready = capabilityAccounting.complete && blockingResources.length === 0;
  return {
    verifiedCapabilities,
    capabilityAccounting,
    blockingResources,
    ready,
    safeReads: {
      status: capabilityAccounting.complete ? "Ready" : "Needs attention",
      proven: proven.filter(
        key =>
          !key.startsWith("custom.write.") &&
          !Object.entries(BROWSER_CAPABILITY_REQUIREMENTS).some(
            ([cap, keys]) => !cap.endsWith(".read") && keys.includes(key)
          )
      ),
      attempted: input.operations.size,
    },
  };
}

/** Recompute current presentation from durable proofs, never from historical job snapshots. */
export function shouldPreserveConnectionStatus(
  status: string,
  authenticationVerified = false
) {
  if (["paused", "disconnected"].includes(status)) return true;
  if (status === "authentication_expired") return !authenticationVerified;
  return false;
}

export async function reconcileCurrentBrowserReadiness(input: {
  organisationId: number;
  connectedSystemId: number;
  authenticationVerified?: boolean;
}) {
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  return db.transaction(async tx => {
    const [system] = await tx
      .select()
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, input.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .for("update");
    if (!system || !["browser", "sidecar"].includes(system.connectionMethod))
      return;
    const rows = await tx
      .select()
      .from(browserLearnedOperations)
      .where(
        and(
          eq(browserLearnedOperations.connectedSystemId, system.id),
          eq(browserLearnedOperations.organisationId, input.organisationId)
        )
      )
      .orderBy(desc(browserLearnedOperations.version));
    const statuses = new Map<string, string>();
    for (const row of rows)
      if (!statuses.has(row.operationKey))
        statuses.set(
          row.operationKey,
          effectiveLatestBrowserOperation(row)!.status
        );
    const [job] = await tx
      .select()
      .from(crmCommissioningJobs)
      .where(eq(crmCommissioningJobs.connectedSystemId, system.id));
    const cursors = await tx
      .select()
      .from(crmSyncCursors)
      .where(eq(crmSyncCursors.connectedSystemId, system.id));
    const current = calculateCurrentReadiness({
      operations: statuses,
      allowedReads: system.allowedReadCapabilities,
      allowedWrites: system.allowedWriteCapabilities,
      discovered: job?.discoveredOperationKeys || [],
      cursors,
    });
    const preserveStatus = shouldPreserveConnectionStatus(
      system.status,
      Boolean(input.authenticationVerified)
    );
    await tx
      .update(connectedSystems)
      .set({
        verifiedCapabilities: current.verifiedCapabilities,
        ...(!preserveStatus
          ? {
              status: current.ready
                ? ("ready" as const)
                : current.verifiedCapabilities.length
                  ? ("limited_permissions" as const)
                  : ("needs_attention" as const),
            }
          : {}),
        lastHealthCheckAt: new Date(),
        ...(input.authenticationVerified &&
        (system.status === "authentication_expired" ||
          /authentication expired/i.test(system.lastHealthSummary || ""))
          ? {
              lastHealthSummary: current.ready
                ? "Browser CRM authentication verified; current readiness restored."
                : "Browser CRM authentication verified; capability readiness was recomputed.",
            }
          : {}),
      })
      .where(eq(connectedSystems.id, system.id));
    if (job) {
      const optionalFailures = Object.fromEntries(
        Object.entries(job.optionalFailures).filter(
          ([key]) => statuses.get(key) !== "LIVE_PROVEN"
        )
      );
      await tx
        .update(crmCommissioningJobs)
        .set({
          progress: {
            ...job.progress,
            safeReads: current.safeReads,
            capabilityAccounting: current.capabilityAccounting,
            ...(current.ready
              ? { humanStatus: "Ready" }
              : job.state === "READY"
                ? { humanStatus: "CRM needs attention" }
                : {}),
          },
          optionalFailures,
          ...(current.ready
            ? {
                state: "READY" as const,
                status: "ready" as const,
                completedAt: job.completedAt ?? new Date(),
                leaseExpiresAt: null,
                lastError: null,
              }
            : job.state === "READY" &&
                !["cancelled", "running"].includes(job.status)
              ? {
                  status: "needs_attention" as const,
                  lastError: job.lastError,
                }
              : {}),
        })
        .where(eq(crmCommissioningJobs.id, job.id));
    }
    return current;
  });
}
