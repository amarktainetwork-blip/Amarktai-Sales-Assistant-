import type { OrganisationMembership } from "./organisation";

export function requireActiveOrganisationContext(ctx: { activeOrganisation: OrganisationMembership | null }, organisationId: number) {
  if (!ctx.activeOrganisation) throw new Error("Choose an organisation before accessing workspace data.");
  if (ctx.activeOrganisation.organisationId !== organisationId) throw new Error("ACTIVE_ORGANISATION_MISMATCH");
  return ctx.activeOrganisation;
}
