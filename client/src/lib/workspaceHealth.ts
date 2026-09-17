/** Source connection health only; local query/display failures are reported by their page. */
export function showCrmAttention(
  systems: Array<{ status: string }> | undefined,
  loaded: boolean
) {
  return (
    loaded &&
    Boolean(
      systems?.some(system =>
        [
          "needs_attention",
          "limited_permissions",
          "authentication_expired",
          "error",
        ].includes(system.status)
      )
    )
  );
}
