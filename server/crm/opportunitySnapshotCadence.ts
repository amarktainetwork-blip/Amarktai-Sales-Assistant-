/** Keep the completed-source freshness window aligned with the actual snapshot scheduler. */
export const DEFAULT_ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS = 15 * 60_000;
export const OPPORTUNITY_SNAPSHOT_COMPLETION_GRACE_MS = 10 * 60_000;
export const OPPORTUNITY_SNAPSHOT_READ_HEADROOM_MS = 7 * 60_000;

// The production CRM worker reconciles on a 60s cadence. With ~5,725
// owner-scoped records, five 100-record pages need 12 worker cycles after
// the nominal 15m due point: contended runs can pass the 25m
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
/** Start scanning early; do not extend the completed-source freshness limit. */
export function routineOpportunitySnapshotReadStartIntervalMs(
  raw: string | number | undefined = process.env.ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS
) {
  return Math.max(
    30_000,
    routineOpportunitySnapshotIntervalMs(raw) - OPPORTUNITY_SNAPSHOT_READ_HEADROOM_MS
  );
}

export function maximumCompletedOpportunitySnapshotAgeMs(
  raw: string | number | undefined = process.env.ROUTINE_OPPORTUNITY_SYNC_INTERVAL_MS
) {
  // A full owner-scoped snapshot must complete; partial batches never renew this clock.
  return routineOpportunitySnapshotIntervalMs(raw) + OPPORTUNITY_SNAPSHOT_COMPLETION_GRACE_MS;
}
