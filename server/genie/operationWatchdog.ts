import { and, desc, eq, inArray } from "drizzle-orm";
import {
  browserLearnedOperations,
  connectedSystems,
} from "../../drizzle/schema";
import { testLearnedBrowserOperation } from "../browserConnectors/browserCrmAdapter";
import { BROWSER_OPERATION_CATALOGUE } from "../browserConnectors/operationContracts";
import { recordBrowserOperationResult } from "../browserConnectors/learnedOperations";
import { loadConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { getDb } from "../db";
import { attemptBoundedAutomaticRepairBatch } from "../crm/automaticCommissioning";
import {
  GENIE_PROVIDER_PACK_VERSION,
  providerPackFingerprint,
} from "../crm/providerPacks";

export function watchdogRepairPlan(
  results: Array<{ operationKey: string; status: "live" | "degraded" }>
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
    status: "live" | "degraded";
    detail?: string;
  }> = [];
  let repairGenxCalls = 0;
  for (const system of systems) {
    const affectedOperationKeys: string[] = [];
    const rows = await db
      .select()
      .from(browserLearnedOperations)
      .where(
        and(
          eq(browserLearnedOperations.organisationId, system.organisationId),
          eq(browserLearnedOperations.connectedSystemId, system.id),
          eq(browserLearnedOperations.status, "LIVE_PROVEN")
        )
      )
      .orderBy(desc(browserLearnedOperations.version));
    const selected = new Map<string, (typeof rows)[number]>();
    for (const row of rows)
      if (safeKeys.has(row.operationKey) && !selected.has(row.operationKey))
        selected.set(row.operationKey, row);
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
    for (const operation of Array.from(selected.values())) {
      try {
        const prerequisites = operation.prerequisites as Record<
          string,
          unknown
        >;
        const watchdogInputs =
          prerequisites.watchdogInputs &&
          typeof prerequisites.watchdogInputs === "object" &&
          !Array.isArray(prerequisites.watchdogInputs)
            ? (prerequisites.watchdogInputs as Record<string, unknown>)
            : {};
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
        await recordBrowserOperationResult({
          organisationId: system.organisationId,
          connectedSystemId: system.id,
          operationKey: operation.operationKey,
          version: operation.version,
          success: false,
          watchdog: true,
          error: detail,
          evidence: {
            watchdog: true,
            failure: detail.slice(0, 800),
            checkedAt: new Date().toISOString(),
          },
        });
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
          : "Daily CRM drift scan passed with no structural operation failures and zero model calls.",
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
            deterministicExecutions: systemResults.length,
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
    success: results.every(result => result.status === "live"),
    checkedSystems: systems.length,
    checkedOperations: results.length,
    results,
    modelUsedDuringVerification: false as const,
    providerCallCountDuringVerification: 0 as const,
    unchangedGenxCalls: results.every(result => result.status === "live")
      ? (0 as const)
      : undefined,
    repairGenxCalls,
  };
}
