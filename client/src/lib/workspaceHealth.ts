/** Source connection health only; local query/display failures are reported by their page. */
export function crmAttentionStatus(
  systems: Array<{ status: string }> | undefined,
  loaded: boolean
) {
  if (!loaded) return undefined;
  return systems?.find(system =>
    ["authentication_expired", "needs_attention", "error"].includes(
      system.status
    )
  )?.status;
}

export function showCrmAttention(
  systems: Array<{ status: string }> | undefined,
  loaded: boolean
) {
  return Boolean(crmAttentionStatus(systems, loaded));
}

export function crmAttentionDelayMs(status: string | undefined) {
  if (!status || status === "authentication_expired") return 0;
  return 45_000;
}
