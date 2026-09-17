import { and, desc, eq, inArray } from "drizzle-orm";
import {
  browserLearnedOperations,
  connectedSystems,
  externalUserMappings,
  users,
} from "../../drizzle/schema";
import { testLearnedBrowserOperation } from "../browserConnectors/browserCrmAdapter";
import {
  BROWSER_OPERATION_CATALOGUE,
  browserProofPolicy,
} from "../browserConnectors/operationContracts";
import { isTransientBrowserExecutionFailure } from "../browserConnectors/runtimeFailure";
import { loadConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { getDb } from "../db";
import { attemptBoundedAutomaticRepairBatch } from "../crm/automaticCommissioning";
import { connectedSystemHasActiveCommissioning } from "../crm/backgroundReadCommissioningGuard";
import {
  GENIE_PROVIDER_PACK_VERSION,
  providerPackFingerprint,
} from "../crm/providerPacks";

export function watchdogRepairPlan(
  results: Array<{
    operationKey: string;
    status:
      | "live"
      | "degraded"
      | "awaiting_verification"
      | "blocked"
      | "retry_pending"
      | "retained";
  }>
) {
  const affectedOperationKeys = Array.from(
    new Set(
      results
        .filter(result => result.status === "degraded")
        .map(result => result.operationKey)
        .filter(key => key !== "commissioning-session")
    )
  );
  return {
    affectedOperationKeys,
    unchangedGenxCalls: affectedOperationKeys.length ? undefined : (0 as const),
    maximumRepairBatches: affectedOperationKeys.length
      ? (1 as const)
      : (0 as const),
  };
}

export function watchdogReplayPayload(
  operationKey: string,
  prerequisites: Record<string, unknown>
) {
  const raw =
    prerequisites.watchdogInputs &&
    typeof prerequisites.watchdogInputs === "object" &&
    !Array.isArray(prerequisites.watchdogInputs)
      ? { ...(prerequisites.watchdogInputs as Record<string, unknown>) }
      : {};
  const policy = browserProofPolicy(operationKey, "read");
  const nonEmpty = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  if (
    policy.requiresExactSearchMatch &&
    !nonEmpty(raw.query) &&
    !nonEmpty(raw.externalId)
  )
    return null;
  if (
    policy.requiresTargetIdentity &&
    !nonEmpty(raw.externalId) &&
    !nonEmpty(raw.contactExternalId)
  )
    return null;
  return raw;
}

export function watchdogIdentityMappingIsConfirmed(
  rows: Array<{ mappingEmail: string | null; userEmail: string | null }>
) {
  if (rows.length !== 1) return false;
  const mappingEmail = rows[0].mappingEmail?.trim().toLowerCase();
  const userEmail = rows[0].userEmail?.trim().toLowerCase();
  return Boolean(mappingEmail && userEmail && mappingEmail === userEmail);
}

export function selectLatestWatchdogVersions<
  T extends { operationKey: string; version: number; status: string },
>(rows: T[], safeKeys: ReadonlySet<string>) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!safeKeys.has(row.operationKey)) continue;
    const current = latest.get(row.operationKey);
    if (!current || row.version > current.version)
      latest.set(row.operationKey, row);
  }
  return Array.from(latest.values()).map(operation => ({
    operation,
    eligible: operation.status === "LIVE_PROVEN",
    reportStatus:
      operation.status === "LIVE_PROVEN"
        ? ("live" as const)
        : operation.status === "TEST_READY"
          ? ("awaiting_verification" as const)
          : operation.status === "DEGRADED"
            ? ("degraded" as const)
            : ("blocked" as const),
  }));
}

/** Verifies only non-destructive learned reads and degrades one failed operation. */
export async function runGenieOperationWatchdog() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = await db
    .select()
    .from(connectedSystems)
    .where(
      and(
        eq(connectedSystems.provider, "genie"),
        inArray(connectedSystems.status, ["ready", "limited_permissions"])
      )
    );
  const safeKeys = new Set(
    BROWSER_OPERATION_CATALOGUE.filter(
      item => item.safeWatchdog && item.mode === "read"
    ).map(item => item.key)
  );
  const results: Array<{
    connectedSystemId: number;
    operationKey: string;
    status:
      | "live"
      | "degraded"
      | "awaiting_verification"
      | "blocked"
      | "retry_pending"
      | "retained";
    detail?: string;
  }> = [];
  let repairGenxCalls = 0;
  for (const system of systems) {
    if (
      await connectedSystemHasActiveCommissioning({
        organisationId: system.organisationId,
        connectedSystemId: system.id,
      })
    ) {
      results.push({
        connectedSystemId: system.id,
        operationKey: "commissioning-active",
        status: "retry_pending",
        detail:
          "CRM commissioning is active; background Genie drift checks are paused.",
      });
      continue;
    }

    const secret = await loadConnectionSecret({
      organisationId: system.organisationId,
      connectedSystemId: system.id,
      secretKind: "browser",
    });
    if (!secret?.commissioningUserId) {
      results.push({
        connectedSystemId: system.id,
        operationKey: "commissioning-session",
        status: "degraded",
        detail: "The commissioning manager must sign in again.",
      });
      continue;
    }

    const identityRows = await db
      .select({
        mappingEmail: externalUserMappings.email,
        userEmail: users.email,
      })
      .from(externalUserMappings)
      .innerJoin(users, eq(users.id, externalUserMappings.userId))
      .where(
        and(
          eq(externalUserMappings.organisationId, system.organisationId),
          eq(externalUserMappings.connectedSystemId, system.id),
          eq(externalUserMappings.userId, secret.commissioningUserId),
          eq(externalUserMappings.isActive, true)
        )
      )
      .limit(2);
    if (!watchdogIdentityMappingIsConfirmed(identityRows)) {
      results.push({
        connectedSystemId: system.id,
        operationKey: "identity-mapping",
        status: "retry_pending",
        detail:
          "CRM identity confirmation is still pending; background Genie drift checks are paused.",
      });
      continue;
    }

    const affectedOperationKeys: string[] = [];
    const rows = await db
      .select()
      .from(browserLearnedOperations)
      .where(
        and(
          eq(browserLearnedOperations.organisationId, system.organisationId),
          eq(browserLearnedOperations.connectedSystemId, system.id)
        )
      )
      .orderBy(desc(browserLearnedOperations.version));
    const decisions = selectLatestWatchdogVersions(rows, safeKeys);
    const selected = decisions
      .filter(decision => decision.eligible)
      .map(decision => decision.operation);
    for (const decision of decisions.filter(item => !item.eligible)) {
      if (decision.reportStatus === "degraded")
        affectedOperationKeys.push(decision.operation.operationKey);
      results.push({
        connectedSystemId: system.id,
        operationKey: decision.operation.operationKey,
        status: decision.reportStatus,
        detail:
          decision.reportStatus === "awaiting_verification"
            ? "The latest operation version is awaiting deterministic verification."
            : decision.reportStatus === "degraded"
              ? "The latest operation version is degraded and requires repair plus re-verification."
              : `The latest operation version is ${decision.operation.status} and cannot run in the watchdog.`,
      });
    }
    for (const operation of selected) {
      try {
        const prerequisites = operation.prerequisites as Record<
          string,
          unknown
        >;
        const watchdogInputs = watchdogReplayPayload(
          operation.operationKey,
          prerequisites
        );
        if (watchdogInputs === null) {
          results.push({
            connectedSystemId: system.id,
            operationKey: operation.operationKey,
            status: "retained",
            detail:
              "Existing LIVE_PROVEN target-bound read retained because no deterministic watchdog target was persisted.",
          });
          continue;
        }
        await testLearnedBrowserOperation({
          connection: toAdapterConnection(system),
          secret,
          provider: "genie",
          operationKey: operation.operationKey,
          payload: watchdogInputs,
          correlationId: `watchdog-${system.id}-${operation.operationKey}-${Date.now()}`,
        });
        results.push({
          connectedSystemId: system.id,
          operationKey: operation.operationKey,
          status: "live",
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (isTransientBrowserExecutionFailure(error)) {
          results.push({
            connectedSystemId: system.id,
            operationKey: operation.operationKey,
            status: "retry_pending",
            detail:
              "CRM access is temporarily busy or unavailable. The learned operation is unchanged.",
          });
          continue;
        }
        // The canonical adapter records the failure once. The watchdog only schedules repair.
        affectedOperationKeys.push(operation.operationKey);
        results.push({
          connectedSystemId: system.id,
          operationKey: operation.operationKey,
          status: "degraded",
          detail: detail.slice(0, 300),
        });
      }
    }
    const systemResults = results.filter(
      result => result.connectedSystemId === system.id
    );
    const repairPlan = watchdogRepairPlan(systemResults);
    const repair = repairPlan.affectedOperationKeys.length
      ? await attemptBoundedAutomaticRepairBatch({
          system,
          operationKeys: repairPlan.affectedOperationKeys,
        }).catch(error => ({
          calls: 0,
          installed: [] as string[],
          reason:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        }))
      : { calls: 0, installed: [] as string[], reason: "unchanged" };
    repairGenxCalls += repair.calls;
    await db
      .update(connectedSystems)
      .set({
        lastHealthCheckAt: new Date(),
        lastHealthSummary: affectedOperationKeys.length
          ? `${affectedOperationKeys.length} CRM operation(s) changed and need deterministic re-verification.`
          : systemResults.every(result =>
                ["live", "retained"].includes(result.status)
              )
            ? systemResults.some(result => result.status === "retained")
              ? "Daily CRM drift scan passed for replayable reads; target-bound reads retained without an invented replay target."
              : "Daily CRM drift scan passed with no structural operation failures and zero model calls."
            : "One or more latest CRM operation versions are not eligible for deterministic watchdog execution.",
        configuration: {
          ...(system.configuration || {}),
          providerPackVersion: GENIE_PROVIDER_PACK_VERSION,
          providerPackFingerprint: providerPackFingerprint(),
          tenantOverlayVersion: String(
            (system.configuration as Record<string, unknown>)
              ?.tenantOverlayVersion || "tenant-1"
          ),
          lastDriftScan: {
            checkedAt: new Date().toISOString(),
            affectedOperationKeys: repairPlan.affectedOperationKeys,
            deterministicExecutions: systemResults.filter(
              result => result.status !== "retained"
            ).length,
            modelUsedDuringVerification: false,
            providerCallCountDuringVerification: 0,
            repairGenxCalls: repair.calls,
            replacementOperationKeys: repair.installed,
          },
        },
      })
      .where(eq(connectedSystems.id, system.id));
  }
  return {
    success: results.every(result =>
      ["live", "retained"].includes(result.status)
    ),
    checkedSystems: systems.length,
    checkedOperations: results.length,
    results,
    modelUsedDuringVerification: false as const,
    providerCallCountDuringVerification: 0 as const,
    unchangedGenxCalls: results.every(result =>
      ["live", "retained"].includes(result.status)
    )
      ? (0 as const)
      : undefined,
    repairGenxCalls,
  };
}
