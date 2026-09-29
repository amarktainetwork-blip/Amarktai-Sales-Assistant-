/**
 * Coalesces duplicate unattended browser-CRM cycles without serializing whole
 * workflows behind one global FIFO.
 *
 * Individual browser operations are already fenced by the shared
 * browser-control lease. Serializing complete mailbox / CRM / watchdog cycles
 * here created head-of-line blocking measured at more than 100 seconds in
 * production, which made Today materially stale.
 */
const inFlightByLabel = new Map<string, Promise<unknown>>();

export function runBackgroundBrowserReadLane<T>(
  label: string,
  run: () => Promise<T>
): Promise<T> {
  const existing = inFlightByLabel.get(label);
  if (existing) return existing as Promise<T>;

  const startedAt = Date.now();
  const task = Promise.resolve().then(run);
  inFlightByLabel.set(label, task);
  void task
    .finally(() => {
      if (inFlightByLabel.get(label) === task) inFlightByLabel.delete(label);
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 1_000)
        console.log(
          JSON.stringify({
            event: "crm_background_read_cycle_duration",
            label,
            durationMs,
          })
        );
    })
    .catch(() => undefined);
  return task;
}

export function resetBackgroundBrowserReadLaneForTests() {
  inFlightByLabel.clear();
}
