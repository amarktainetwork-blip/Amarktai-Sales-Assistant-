/** Keep the completed-source freshness window aligned with the actual snapshot scheduler. */
export const DEFAULT_ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS = 15 * 60_000;
export const OPPORTUNITY_SNAPSHOT_COMPLETION_GRACE_MS = 10 * 60_000;

// The production CRM worker reconciles on a 60s cadence. With ~5,725
// owner-scoped records, five 100-record pages need 12 worker cycles after
// the 15m scheduling delay: even healthy snapshots age past the 25m
// completed-source window. Ten bounded pages need six cycles while remaining
// within the already enforced 12-page source cap and 120s user-read watchdog.
export const DEFAULT_ROUTINE_OPPORTUNITY_BATCH_PAGES = 10;


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
