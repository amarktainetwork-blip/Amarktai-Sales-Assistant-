export type RetentionPolicy = {
  transcriptRetentionDays: number;
  auditRetentionDays: number;
  operationalRetentionDays: number;
};

export type RetentionPlan = {
  dryRun: boolean;
  cutoffs: { transcripts: Date; audit: Date; operational: Date };
};

const boundedRetentionDays = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > 3_650) {
    throw new Error("Retention periods must be whole days between 1 and 3650.");
  }
  return value;
};

export function buildRetentionPlan(policy: RetentionPolicy, now = new Date(), execute = false): RetentionPlan {
  if (Number.isNaN(now.valueOf())) throw new Error("A valid execution time is required.");
  const cutoff = (days: number) => new Date(now.valueOf() - boundedRetentionDays(days) * 86_400_000);
  return {
    dryRun: !execute,
    cutoffs: {
      transcripts: cutoff(policy.transcriptRetentionDays),
      audit: cutoff(policy.auditRetentionDays),
      operational: cutoff(policy.operationalRetentionDays),
    },
  };
}

/** Deletion workers must receive an explicit reviewed request rather than a timer-only signal. */
export function canExecuteDestructiveRetention(input: { approved: boolean; requestedExecute: boolean }) {
  return input.approved === true && input.requestedExecute === true;
}
