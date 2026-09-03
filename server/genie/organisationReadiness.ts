import { browserOperationReadinessForSystem } from "../browserConnectors/learnedOperations";
import { coreBrowserCommissioningReady } from "../crm/commissioningReadiness";

type OrganisationSystem = {
  id: number;
  provider: string;
  connectionMethod: string;
  status: string;
  verifiedCapabilities: string[];
  lastHealthCheckAt?: Date | null;
  lastHealthSummary?: string | null;
};

type BrowserReadinessMatrix = Awaited<
  ReturnType<typeof browserOperationReadinessForSystem>
>;

export function deriveOrganisationGenieReadiness(input: {
  genieSystems: OrganisationSystem[];
  commissionedSystems: OrganisationSystem[];
  matrices: BrowserReadinessMatrix[];
}) {
  const perSystem = input.commissionedSystems.map((system, index) => {
    const matrix = input.matrices[index];
    const statuses = new Map(
      (matrix?.operations || []).map(operation => [
        operation.key,
        operation.status,
      ])
    );
    const liveOperations = (matrix?.operations || [])
      .filter(operation => operation.status === "LIVE_PROVEN")
      .map(operation => operation.key);
    const coreOperational = coreBrowserCommissioningReady(statuses);
    const allCatalogueOperationsProven = Boolean(matrix?.operations.length) &&
      matrix.operations.every(operation => operation.status === "LIVE_PROVEN");

    return {
      connectedSystemId: system.id,
      coreOperational,
      allCatalogueOperationsProven,
      liveOperations,
      capabilities: matrix?.capabilities || [],
    };
  });

  const liveOperations = Array.from(
    new Set(perSystem.flatMap(system => system.liveOperations))
  );
  const coreOperational = perSystem.some(system => system.coreOperational);
  const allCatalogueOperationsProven = perSystem.some(
    system => system.coreOperational && system.allCatalogueOperationsProven
  );
  const configured = input.genieSystems.length > 0;
  const authenticated = input.commissionedSystems.length > 0;

  return {
    configured,
    // Backward-compatible boolean used by dashboards and agent dependency
    // gates. "ready" now means the browser CRM passed the same core
    // LIVE_PROVEN gate as automatic commissioning; authentication alone is
    // deliberately insufficient.
    ready: coreOperational,
    coreOperational,
    allCatalogueOperationsProven,
    status: coreOperational
      ? "commissioned"
      : authenticated
        ? "authenticated_training_required"
        : configured
          ? "needs_attention"
          : "not_connected",
    operationalStatus: allCatalogueOperationsProven
      ? "ready"
      : coreOperational
        ? "operational_with_limits"
        : authenticated
          ? "commissioning"
          : configured
            ? "needs_attention"
            : "not_connected",
    connectedSystemIds: input.genieSystems.map(system => system.id),
    verifiedCapabilities: Array.from(
      new Set(
        input.commissionedSystems.flatMap(system => system.verifiedCapabilities)
      )
    ),
    liveOperations,
    capabilities: perSystem.map(system => ({
      connectedSystemId: system.connectedSystemId,
      readiness: system.capabilities,
    })),
    summary: allCatalogueOperationsProven
      ? `${input.commissionedSystems.length} Genie connection(s) have every catalogue operation LIVE_PROVEN.`
      : coreOperational
        ? `Genie core sales operations are LIVE_PROVEN with ${liveOperations.length} proven operation(s); optional CRM functions can continue commissioning without blocking the working core.`
        : authenticated
          ? "Genie authentication is verified, but the required core operations are not yet LIVE_PROVEN. Finish automatic commissioning or Teach Amarktai before the workspace can be called ready."
          : configured
            ? "A Genie connection exists but its latest authentication test needs attention."
            : "No organisation Genie connection exists.",
  };
}

export async function getOrganisationGenieReadiness(
  organisationId: number,
  systems: OrganisationSystem[]
) {
  const genieSystems = systems.filter(
    system =>
      system.provider === "genie" &&
      (system.connectionMethod === "browser" ||
        system.connectionMethod === "sidecar")
  );
  const commissionedSystems = genieSystems.filter(system =>
    ["ready", "limited_permissions"].includes(system.status)
  );
  const matrices = await Promise.all(
    commissionedSystems.map(system =>
      browserOperationReadinessForSystem({
        organisationId,
        connectedSystemId: system.id,
      })
    )
  );

  return deriveOrganisationGenieReadiness({
    genieSystems,
    commissionedSystems,
    matrices,
  });
}
