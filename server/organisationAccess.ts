export type OrganisationRole = "owner" | "manager" | "salesperson" | "auditor";
export type OrganisationMembershipIdentity = { organisationId: number; userId: number; role: OrganisationRole; isActive: boolean };

export function hasOrganisationAccess(membership: OrganisationMembershipIdentity | null | undefined, organisationId: number, userId: number) {
  return Boolean(membership && membership.isActive && membership.organisationId === organisationId && membership.userId === userId);
}

export function canViewTeamData(role: OrganisationRole) {
  return role === "owner" || role === "manager" || role === "auditor";
}

export function canManageOrganisation(role: OrganisationRole) {
  return role === "owner" || role === "manager";
}
