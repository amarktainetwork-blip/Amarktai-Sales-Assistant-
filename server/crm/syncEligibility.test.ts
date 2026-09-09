import { describe, expect, it } from "vitest";
import { crmResourceSyncEligible } from "./sync";

describe("CRM resource sync eligibility", () => {
  const connection = {
    allowedReadCapabilities: [
      "contacts.read",
      "companies.read",
      "tasks.read",
    ],
    verifiedCapabilities: ["contacts.read"],
  };

  it("syncs only an authorised capability that is also LIVE_PROVEN/verified", () => {
    expect(crmResourceSyncEligible(connection, "contacts.read")).toBe(true);
    expect(crmResourceSyncEligible(connection, "companies.read")).toBe(false);
    expect(crmResourceSyncEligible(connection, "tasks.read")).toBe(false);
  });

  it("never syncs a capability that was not authorised even if a stale verification value exists", () => {
    expect(
      crmResourceSyncEligible(
        {
          allowedReadCapabilities: ["contacts.read"],
          verifiedCapabilities: ["contacts.read", "opportunities.read"],
        },
        "opportunities.read"
      )
    ).toBe(false);
  });
});
