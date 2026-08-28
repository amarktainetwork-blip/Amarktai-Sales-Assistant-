import { browserOperationReadinessForSystem } from "../browserConnectors/learnedOperations";

export type RuntimeLearnedOperation = {
  operationKey: string;
  label: string;
  mode: "read" | "write";
  status: string;
  version: number;
  lastTestAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  productionReady: boolean;
};

export type RuntimeConnectedSystem = {
  id: number;
  status: string;
  connectionMethod: string;
  verifiedCapabilities: string[];
  learnedOperations?: RuntimeLearnedOperation[];
  [key: string]: unknown;
};

export function isRuntimeConnectionStatus(status: string) {
  return status === "ready" || status === "limited_permissions";
}

export function isCustomOperationKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^custom\.(?:read|write)\.[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value.trim())
  );
}

export function productionOperationAvailable(
  operations: RuntimeLearnedOperation[] | undefined,
  operationKey: string
) {
  return Boolean(
    operations?.some(
      operation =>
        operation.operationKey === operationKey &&
        operation.status === "LIVE_PROVEN" &&
        operation.productionReady
    )
  );
}

function safeOperation(operation: Record<string, unknown>): RuntimeLearnedOperation {
  const operationKey = String(operation.key || operation.operationKey || "");
  const mode = operation.mode === "write" ? "write" : "read";
  const status = String(operation.status || "NOT_LEARNED");
  return {
    operationKey,
    label: String(operation.label || operationKey || "CRM-specific function").slice(0, 160),
    mode,
    status,
    version: Number(operation.version || 0),
    lastTestAt: operation.lastTestAt instanceof Date ? operation.lastTestAt : null,
    lastSuccessAt:
      operation.lastSuccessAt instanceof Date ? operation.lastSuccessAt : null,
    lastFailureAt:
      operation.lastFailureAt instanceof Date ? operation.lastFailureAt : null,
    productionReady: status === "LIVE_PROVEN",
  };
}

/**
 * Adds only customer-safe operation commissioning metadata. Definitions,
 * selectors, evidence payloads and browser/session material never leave the
 * server through this projection.
 */
export async function attachRuntimeOperationReadiness<
  T extends RuntimeConnectedSystem,
>(input: { organisationId: number; systems: T[] }): Promise<Array<T & { learnedOperations: RuntimeLearnedOperation[] }>> {
  return Promise.all(
    input.systems.map(async system => {
      if (
        system.connectionMethod !== "browser" &&
        system.connectionMethod !== "sidecar"
      )
        return { ...system, learnedOperations: [] };
      const matrix = await browserOperationReadinessForSystem({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
      });
      const learnedOperations = matrix.operations
        .map(operation =>
          safeOperation(operation as unknown as Record<string, unknown>)
        )
        .filter(operation => operation.operationKey.startsWith("custom."));
      return { ...system, learnedOperations };
    })
  );
}
