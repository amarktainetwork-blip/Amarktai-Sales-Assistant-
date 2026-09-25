/**
 * Serializes unattended browser-CRM read cycles inside the worker process.
 *
 * Low-level browser operations already use a cross-process control lease. This
 * lane prevents our own mailbox, lead-watch, CRM reconciliation and watchdog
 * timers from fighting over that lease between individual read operations.
 */
let tail: Promise<void> = Promise.resolve();
const inFlightByLabel = new Map<string, Promise<unknown>>();

export function runBackgroundBrowserReadLane<T>(
  label: string,
  run: () => Promise<T>
): Promise<T> {
  const existing = inFlightByLabel.get(label);
  if (existing) return existing as Promise<T>;

  const task = runQueuedBackgroundRead(label, run);
  inFlightByLabel.set(label, task);
  void task
    .finally(() => {
      if (inFlightByLabel.get(label) === task) inFlightByLabel.delete(label);
    })
    .catch(() => undefined);
  return task;
}

async function runQueuedBackgroundRead<T>(
  label: string,
  run: () => Promise<T>
): Promise<T> {
  let release!: () => void;
  const slot = new Promise<void>(resolve => {
    release = resolve;
  });
  const previous = tail;
  tail = previous.catch(() => undefined).then(() => slot);

  const queuedAt = Date.now();
  await previous.catch(() => undefined);
  const waitedMs = Date.now() - queuedAt;
  if (waitedMs >= 1_000)
    console.log(
      JSON.stringify({
        event: "crm_background_read_lane_wait",
        label,
        waitedMs,
      })
    );

  try {
    return await run();
  } finally {
    release();
  }
}

export function resetBackgroundBrowserReadLaneForTests() {
  tail = Promise.resolve();
  inFlightByLabel.clear();
}
