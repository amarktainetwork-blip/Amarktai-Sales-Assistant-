import { describe, expect, it } from "vitest";
import {
  exactDiscoveredCrmIdentityCandidates,
  exactMappedIdentityRows,
  memberCompanySetupComplete,
  personalCrmIdentityRequired,
} from "./userOnboardingRoutes";

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

describe("personal CRM identity timing", () => {
  it("does not require an individual owner identity before company CRM setup exists", () => {
    expect(
      personalCrmIdentityRequired({
        role: "owner",
        workspaceMode: "individual",
        companyComplete: false,
      })
    ).toBe(false);
  });

  it("requires an individual owner identity after company CRM setup completes", () => {
    expect(
      personalCrmIdentityRequired({
        role: "owner",
        workspaceMode: "individual",
        companyComplete: true,
      })
    ).toBe(true);
  });

  it("continues to require a salesperson identity", () => {
    expect(
      personalCrmIdentityRequired({
        role: "salesperson",
        workspaceMode: "team",
        companyComplete: true,
      })
    ).toBe(true);
  });
});

describe("personal email source choice", () => {
  it("keeps Genie and Microsoft as per-member onboarding choices", async () => {
    const { readFileSync } = await import("node:fs");
    const organisation = readFileSync(
      new URL("./organisation.ts", import.meta.url),
      "utf8"
    );
    const routes = readFileSync(
      new URL("./userOnboardingRoutes.ts", import.meta.url),
      "utf8"
    );
    expect(organisation).toContain('emailSource?: "genie" | "microsoft"');
    expect(routes).toContain('req.body?.emailSource === "genie"');
    expect(routes).toContain('req.body?.emailSource === "microsoft"');
    expect(routes).toContain("genieConnected");
    expect(routes).toContain("requiresCrmSignIn");
  });
});


describe("CRM identity refresh exact-email isolation", () => {
  const discovered = [
    {
      externalId: "owner-1",
      displayName: "Amelia De Beer",
      email: "amelia@example.com",
    },
    {
      externalId: "owner-2",
      displayName: "Other User",
      email: "other@example.com",
    },
  ];

  it("keeps only the signed-in account's exact CRM email match", () => {
    expect(
      exactDiscoveredCrmIdentityCandidates({
        users: discovered,
        accountEmail: " AMELIA@example.com ",
      })
    ).toEqual([discovered[0]]);
  });

  it("returns no candidate when the signed-in account email does not match", () => {
    expect(
      exactDiscoveredCrmIdentityCandidates({
        users: discovered,
        accountEmail: "missing@example.com",
      })
    ).toEqual([]);
  });
});

describe("salesperson CRM email identity isolation", () => {
  const rows = [
    { userId: 7, email: "amelia@example.com", id: 1 },
    { userId: 8, email: "other@example.com", id: 2 },
  ];

  it("accepts exactly one mapping whose email equals the signed-in user email", () => {
    expect(
      exactMappedIdentityRows({
        rows,
        userId: 7,
        userEmail: " AMELIA@example.com ",
      })
    ).toEqual([rows[0]]);
  });

  it("fails closed for an email mismatch", () => {
    expect(
      exactMappedIdentityRows({
        rows,
        userId: 7,
        userEmail: "wrong@example.com",
      })
    ).toEqual([]);
  });

  it("fails closed for duplicate exact mappings", () => {
    expect(
      exactMappedIdentityRows({
        rows: [...rows, { userId: 7, email: "amelia@example.com", id: 3 }],
        userId: 7,
        userEmail: "amelia@example.com",
      })
    ).toEqual([]);
  });
});
