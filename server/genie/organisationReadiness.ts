import { browserOperationReadinessForSystem } from "../browserConnectors/learnedOperations";

type OrganisationSystem = {
  id: number;
  provider: string;
  connectionMethod: string;
  status: string;
  verifiedCapabilities: string[];
  lastHealthCheckAt?: Date | null;
  lastHealthSummary?: string | null;
};

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
  const commissioned = genieSystems.filter(system =>
    ["ready", "limited_permissions"].includes(system.status)
  );
  const matrices = await Promise.all(
    commissioned.map(system =>
      browserOperationReadinessForSystem({
        organisationId,
        connectedSystemId: system.id,
      })
    )
  );
  const liveOperations = matrices.flatMap(matrix =>
    matrix.operations
      .filter(operation => operation.status === "LIVE_PROVEN")
      .map(operation => operation.key)
  );
  return {
    configured: genieSystems.length > 0,
    ready: commissioned.length > 0,
    status: commissioned.length
      ? liveOperations.length
        ? "commissioned"
        : "authenticated_training_required"
      : genieSystems.length
        ? "needs_attention"
        : "not_connected",
    connectedSystemIds: genieSystems.map(system => system.id),
    verifiedCapabilities: Array.from(
      new Set(commissioned.flatMap(system => system.verifiedCapabilities))
    ),
    liveOperations: Array.from(new Set(liveOperations)),
    summary: commissioned.length
      ? liveOperations.length
        ? `${commissioned.length} Genie connection(s) are verified with ${liveOperations.length} LIVE_PROVEN operation(s).`
        : "Genie authentication is verified; guided operation commissioning is still required."
      : genieSystems.length
        ? "A Genie connection exists but its latest authentication test needs attention."
        : "No organisation Genie connection exists.",
  };
}
