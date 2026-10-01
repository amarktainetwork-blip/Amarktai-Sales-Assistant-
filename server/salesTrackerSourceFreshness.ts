/**
 * A previous successful full CRM snapshot is baseline evidence, not perpetual
 * proof of current opportunity totals. Incremental bounded batches must not
 * silently renew a completed-snapshot timestamp.
 */
export function completedOpportunitySnapshotIsCurrent(input: {
  sourceStatus: string;
  lastSuccessfulAt: Date | null | undefined;
  lastError?: string | null;
  now: Date;
  maximumAgeMs: number;
}) {
  if (
    !["ready", "limited_permissions"].includes(input.sourceStatus) ||
    !input.lastSuccessfulAt ||
    input.lastError ||
    !Number.isFinite(input.maximumAgeMs) ||
    input.maximumAgeMs <= 0
  )
    return false;
  const ageMs = input.now.getTime() - input.lastSuccessfulAt.getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= input.maximumAgeMs;
}
