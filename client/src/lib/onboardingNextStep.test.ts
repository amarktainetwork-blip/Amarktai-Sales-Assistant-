import { describe, expect, it } from "vitest";
import { nextRequiredOnboardingPath } from "./onboardingNextStep";

const complete = {
  canManage: true,
  company: { complete: true },
  identity: { mappingsExist: false, mapped: false },
  mailbox: { configured: true, connected: true },
  role: "owner" as const,
};

describe("next required onboarding route", () => {
  it("does not let mailbox or personal completion bypass unfinished CRM/company setup", () => {
    expect(
      nextRequiredOnboardingPath({
        ...complete,
        company: { complete: false },
        mailbox: { configured: true, connected: true },
      })
    ).toBe("/company-setup");
  });

  it("keeps unresolved CRM identity inside the guided onboarding gate instead of sending the user to Assistant", () => {
    expect(
      nextRequiredOnboardingPath({
        ...complete,
        canManage: false,
        role: "salesperson",
        identity: { mappingsExist: true, mapped: false },
      })
    ).toBe("/today");
  });

  it("keeps an unfinished mailbox connection inside the guided onboarding gate instead of sending the user to Assistant", () => {
    expect(
      nextRequiredOnboardingPath({
        ...complete,
        mailbox: { configured: true, connected: false },
      })
    ).toBe("/today");
  });

  it("enters Home only after every required setup gate is complete", () => {
    expect(nextRequiredOnboardingPath(complete)).toBe("/today");
  });
});
