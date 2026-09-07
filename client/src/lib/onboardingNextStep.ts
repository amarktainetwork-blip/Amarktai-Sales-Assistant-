export type OnboardingRouteSnapshot = {
  canManage: boolean;
  company: { complete: boolean };
  identity: { mappingsExist: boolean; mapped: boolean };
  mailbox: { configured: boolean; connected: boolean };
  role: "owner" | "manager" | "salesperson" | "auditor";
};

/** One deterministic route resolver keeps every setup completion path honest. */
export function nextRequiredOnboardingPath(
  snapshot: OnboardingRouteSnapshot
) {
  if (snapshot.canManage && !snapshot.company.complete)
    return "/company-setup";
  if (
    snapshot.role === "salesperson" &&
    snapshot.identity.mappingsExist &&
    !snapshot.identity.mapped
  )
    return "/assistant";
  if (
    snapshot.company.complete &&
    snapshot.mailbox.configured &&
    !snapshot.mailbox.connected
  )
    return "/assistant";
  return "/today";
}
