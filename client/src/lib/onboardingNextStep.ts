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

  // CRM identity and mailbox completion are first-class steps inside the
  // MemberOnboardingGate. Route back to Today so that gate stays in control of
  // the setup journey instead of dropping a new user into the general
  // Assistant and expecting them to discover the missing setup action there.
  if (
    snapshot.role === "salesperson" &&
    snapshot.identity.mappingsExist &&
    !snapshot.identity.mapped
  )
    return "/today";
  if (
    snapshot.company.complete &&
    snapshot.mailbox.configured &&
    !snapshot.mailbox.connected
  )
    return "/today";
  return "/today";
}
