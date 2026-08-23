/** Navigate to the application's own local authentication screen. */
export function startLogin() {
  if (typeof window !== "undefined" && window.location.pathname !== "/auth") {
    window.location.assign("/auth");
  }
}
