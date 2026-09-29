export type TimedWorkCandidate = {
  key: string;
  name: string;
  headline: string;
  dueAt: Date | string | null;
};

export function timedWorkAttentions<T extends TimedWorkCandidate>(
  items: T[],
  nowMs: number,
  soonWindowMs = 30 * 60_000,
  dueNowGraceMs = 60_000
) {
  return items
    .filter(candidate => {
      if (!candidate.dueAt) return false;
      const delta = new Date(candidate.dueAt).valueOf() - nowMs;
      return delta >= -dueNowGraceMs && delta <= soonWindowMs;
    })
    .sort((a, b) => new Date(a.dueAt!).valueOf() - new Date(b.dueAt!).valueOf())
    .map(item => {
      const dueAtMs = new Date(item.dueAt!).valueOf();
      const phase = dueAtMs <= nowMs ? ("due" as const) : ("soon" as const);
      return {
        item,
        phase,
        minutes: Math.max(0, Math.ceil((dueAtMs - nowMs) / 60_000)),
      };
    });
}

export function timedWorkAttention<T extends TimedWorkCandidate>(
  items: T[],
  nowMs: number,
  soonWindowMs = 30 * 60_000,
  dueNowGraceMs = 60_000
) {
  return (
    timedWorkAttentions(items, nowMs, soonWindowMs, dueNowGraceMs)[0] ?? null
  );
}
