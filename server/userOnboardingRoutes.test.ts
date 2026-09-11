import { describe, expect, it } from "vitest";
import { memberCompanySetupComplete } from "./userOnboardingRoutes";

describe("member handover company readiness", () => {
  it("allows member onboarding after shared company setup and CRM connection without pre-proving CRM operations", () => {
    expect(
      memberCompanySetupComplete({
        storedComplete: true,
        companyKnowledgeReady: true,
        crmConnected: true,
      })
    ).toBe(true);
  });

  it.each([
    { storedComplete: false, companyKnowledgeReady: true, crmConnected: true },
    { storedComplete: true, companyKnowledgeReady: false, crmConnected: true },
    { storedComplete: true, companyKnowledgeReady: true, crmConnected: false },
  ])("still fails closed when shared setup is incomplete: %o", input => {
    expect(memberCompanySetupComplete(input)).toBe(false);
  });
});
