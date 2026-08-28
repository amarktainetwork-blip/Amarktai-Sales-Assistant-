import { canViewTeamData, requireOrganisationMembership } from "./organisation";
import { getSalesWatchtower } from "./salesCommsWatchtower";

export async function getManagerWatchtower(input: {
  userId: number;
  organisationId: number;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!canViewTeamData(membership.role))
    throw new Error(
      "Manager Watchtower is available only to organisation owners, managers, and auditors."
    );
  const watchtower = await getSalesWatchtower(input);
  return {
    generatedAt: watchtower.generatedAt,
    ...watchtower.managerWatchtower,
    topAttention: watchtower.attention.slice(0, 20),
    evidenceSummary: watchtower.evidenceSummary,
  };
}
