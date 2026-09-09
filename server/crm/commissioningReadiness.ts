export const CORE_BROWSER_OPERATIONS = [
  "contact.search",
  "contact.read",
  "contact.sync",
] as const;

export function coreBrowserCommissioningReady(
  statuses: ReadonlyMap<string, string>
) {
  return CORE_BROWSER_OPERATIONS.every(
    key => statuses.get(key) === "LIVE_PROVEN"
  );
}
