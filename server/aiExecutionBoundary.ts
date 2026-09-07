import { AsyncLocalStorage } from "node:async_hooks";

export type ModelFreePurpose =
  | "crm_operation"
  | "crm_sync"
  | "crm_refresh"
  | "mailbox_sync"
  | "mailbox_transport"
  | "mailbox_readback"
  | "checkpoint"
  | "deduplication";

type ModelSpendBoundary = {
  mode: "forbid";
  purpose: ModelFreePurpose;
  organisationId?: number;
  connectedSystemId?: number;
  reference?: string;
  providerCallAttempts: number;
};

const boundaryStorage = new AsyncLocalStorage<ModelSpendBoundary>();

export function currentModelSpendBoundary() {
  return boundaryStorage.getStore();
}

/** Every provider entry point calls this before configuration or network work. */
export function assertModelSpendAllowed(provider: string, feature?: string) {
  const boundary = currentModelSpendBoundary();
  if (!boundary) return;
  boundary.providerCallAttempts += 1;
  throw new Error(
    `MODEL_SPEND_FORBIDDEN: ${provider}${feature ? `/${feature}` : ""} cannot run during deterministic ${boundary.purpose}.`
  );
}

export type ModelFreeEvidence = {
  modelUsed: false;
  providerCallCount: 0;
  purpose: ModelFreePurpose;
  organisationId?: number;
  connectedSystemId?: number;
  reference?: string;
};

/**
 * Runs deterministic transport/connector work inside a fail-closed boundary.
 * Evidence is trustworthy because every model-provider entry point rejects the
 * call while this async scope is active; a successful return therefore proves
 * that the provider-call count stayed at zero.
 */
export async function runModelFreeOperation<T>(
  input: Omit<ModelSpendBoundary, "mode" | "providerCallAttempts">,
  operation: () => Promise<T>
): Promise<{ value: T; evidence: ModelFreeEvidence }> {
  const existing = currentModelSpendBoundary();
  if (existing) {
    const value = await operation();
    return {
      value,
      evidence: {
        modelUsed: false,
        providerCallCount: 0,
        purpose: existing.purpose,
        organisationId: existing.organisationId,
        connectedSystemId: existing.connectedSystemId,
        reference: existing.reference,
      },
    };
  }
  const boundary: ModelSpendBoundary = {
    mode: "forbid",
    providerCallAttempts: 0,
    ...input,
  };
  return boundaryStorage.run(boundary, async () => {
    const value = await operation();
    if (boundary.providerCallAttempts !== 0)
      throw new Error("MODEL_SPEND_BOUNDARY_BREACHED");
    return {
      value,
      evidence: {
        modelUsed: false,
        providerCallCount: 0,
        purpose: boundary.purpose,
        organisationId: boundary.organisationId,
        connectedSystemId: boundary.connectedSystemId,
        reference: boundary.reference,
      },
    };
  });
}
