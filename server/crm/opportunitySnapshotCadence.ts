/** Keep the completed-source freshness window aligned with the actual snapshot scheduler. */
export const DEFAULT_ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS = 15 * 60_000;
export const OPPORTUNITY_SNAPSHOT_COMPLETION_GRACE_MS = 10 * 60_000;

export function routineOpportunitySnapshotIntervalMs(
  raw: string | number | undefined = process.env.ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS
) {
  const parsed = Number(raw || DEFAULT_ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 5 * 60_000
    ? Math.floor(parsed)
    : DEFAULT_ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS;
}
export function maximumCompletedOpportunitySnapshotAgeMs(
  raw: string | number | undefined = process.env.ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS
) {
  // A complete bounded snapshot needs multiple 500-record worker cycles.
  return routineOpportunitySnapshotIntervalMs(raw) + OPPORTUNITY_SNAPSHOT_COMPLETION_GRACE_MS;
}
