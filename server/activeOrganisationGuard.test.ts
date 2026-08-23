import { describe, expect, it } from "vitest";
import { requireActiveOrganisationContext } from "./activeOrganisationGuard";

const membership = { organisationId: 7, userId: 2, role: "manager" as const, organisationName: "North", timezone: "UTC", locale: "en", currency: "USD" };

describe("active organisation tRPC guard", () => {
  it("accepts only the organisation signed into request context", () => {
    expect(requireActiveOrganisationContext({ activeOrganisation: membership }, 7)).toBe(membership);
  });

  it("blocks connected-system, sales, management, and sidecar callers that submit a different organisation id", () => {
    for (const operation of ["connected systems", "sales", "management", "sidecar"]) {
      expect(() => requireActiveOrganisationContext({ activeOrganisation: membership }, 8), operation).toThrow("ACTIVE_ORGANISATION_MISMATCH");
    }
  });

  it("requires an explicit selection before tenant-sensitive operations", () => {
    expect(() => requireActiveOrganisationContext({ activeOrganisation: null }, 7)).toThrow("Choose an organisation");
  });
});
