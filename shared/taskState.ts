/** Unknown source state must not turn historical records into actionable work. */
export const INCOMPLETE_TASK_STATUSES = [
  "open",
  "pending",
  "incomplete",
  "not_started",
  "in_progress",
  "scheduled",
  "todo",
  "to_do",
] as const;
export function isIncompleteTask(status: string) {
  return (INCOMPLETE_TASK_STATUSES as readonly string[]).includes(
    status.trim().toLowerCase().replace(/[ -]+/g, "_")
  );
}
export function isCompletedTask(status: string) {
  return [
    "completed",
    "complete",
    "done",
    "closed",
    "cancelled",
    "canceled",
  ].includes(status.trim().toLowerCase());
}
