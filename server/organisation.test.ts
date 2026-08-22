import { describe, expect, it } from "vitest";
import { selectActiveMembership, type OrganisationMembership } from "./organisation";

const member = (organisationId: number): OrganisationMembership => ({
  organisationId,
  userId: 7,
  role: "owner",
  organisationName: `Workspace ${organisationId}`,
  timezone: "UTC",
  locale: "en",
  currency: "USD",
});

describe("active organisation selection", () => {
  it("uses the sole membership only when no tenant claim is present", () => {
    expect(selectActiveMembership([member(12)], null)?.organisationId).toBe(12);
  });

  it("requires an explicit choice for a multi-organisation user", () => {
    expect(() => selectActiveMembership([member(12), member(44)], null)).toThrow("ACTIVE_ORGANISATION_REQUIRED");
  });

  it("rejects a signed organisation claim that is not an active membership", () => {
    expect(() => selectActiveMembership([member(12)], 44)).toThrow("ACTIVE_ORGANISATION_ACCESS_DENIED");
  });

  it("selects only the signed membership when the user belongs to more than one organisation", () => {
    expect(selectActiveMembership([member(12), member(44)], 44)?.organisationId).toBe(44);
  });
});
