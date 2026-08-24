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
import { attemptBoundedAutomaticRepair } from "../crm/automaticCommissioning";

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
  for (const system of systems) {
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
        await attemptBoundedAutomaticRepair({
          system,
          operationKey: operation.operationKey,
          previousVersion: operation.version,
        }).catch(repairError =>
          console.warn("[genie-watchdog] automatic repair candidate unavailable", {
            connectedSystemId: system.id,
            operationKey: operation.operationKey,
            detail: repairError instanceof Error ? repairError.message : String(repairError),
          })
        );
        results.push({
          connectedSystemId: system.id,
          operationKey: operation.operationKey,
          status: "degraded",
          detail: detail.slice(0, 300),
        });
      }
    }
  }
  return {
    success: results.every(result => result.status === "live"),
    checkedSystems: systems.length,
    checkedOperations: results.length,
    results,
  };
}
