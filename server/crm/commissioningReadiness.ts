export const CORE_BROWSER_OPERATIONS = [
  "contact.search",
  "contact.read",
  "task.list",
  "note.create",
  "task.create_callback",
  "opportunity.read",
  "opportunity.update",
] as const;

export function coreBrowserCommissioningReady(
  statuses: ReadonlyMap<string, string>
) {
  return CORE_BROWSER_OPERATIONS.every(
    key => statuses.get(key) === "LIVE_PROVEN"
  );
}
