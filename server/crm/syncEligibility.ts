export type CrmResourceSyncEligibilityConnection = {
  allowedReadCapabilities: readonly string[];
  verifiedCapabilities: readonly string[];
  connectionMethod?: string;
};

/**
 * Native/API connectors keep their connection-level verified capability gate.
 * Browser/sidecar connectors may synchronise a resource when the exact
 * deterministic sync operation for that resource is LIVE_PROVEN, even while
 * sibling search/read operations leave the broader capability LIMITED.
 */
export function crmResourceSyncEligible(
  connection: CrmResourceSyncEligibilityConnection,
  capability: string,
  browserSyncOperationStatus?: string
) {
  if (!connection.allowedReadCapabilities.includes(capability)) return false;

  if (
    connection.connectionMethod === "browser" ||
    connection.connectionMethod === "sidecar"
  )
    return browserSyncOperationStatus === "LIVE_PROVEN";

  return connection.verifiedCapabilities.includes(capability);
}
