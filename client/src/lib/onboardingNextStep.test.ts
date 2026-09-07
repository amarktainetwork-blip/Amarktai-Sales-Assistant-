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

  it("enters Home only after every required setup gate is complete", () => {
    expect(nextRequiredOnboardingPath(complete)).toBe("/today");
  });
});
