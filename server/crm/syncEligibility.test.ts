import { describe, expect, it } from "vitest";
import { crmResourceSyncEligible } from "./syncEligibility";

describe("CRM resource sync eligibility", () => {
  it("allows a browser resource when its exact deterministic sync operation is LIVE_PROVEN", () => {
    expect(
      crmResourceSyncEligible(
        {
          connectionMethod: "browser",
          allowedReadCapabilities: ["contacts.read"],
          verifiedCapabilities: [],
        },
        "contacts.read",
        "LIVE_PROVEN"
      )
    ).toBe(true);
  });

  it("fails closed for browser resources unless the exact sync operation is LIVE_PROVEN", () => {
    for (const status of [
      undefined,
      "NOT_LEARNED",
      "LEARNED",
      "TEST_READY",
      "DEGRADED",
      "BLOCKED",
    ]) {
      expect(
        crmResourceSyncEligible(
          {
            connectionMethod: "sidecar",
            allowedReadCapabilities: ["contacts.read"],
            verifiedCapabilities: ["contacts.read"],
          },
          "contacts.read",
          status
        )
      ).toBe(false);
    }
  });

  it("never syncs a browser resource that is not authorised even when its operation is LIVE_PROVEN", () => {
    expect(
      crmResourceSyncEligible(
        {
          connectionMethod: "browser",
          allowedReadCapabilities: [],
          verifiedCapabilities: ["contacts.read"],
        },
        "contacts.read",
        "LIVE_PROVEN"
      )
    ).toBe(false);
  });

  it("preserves the verified-capability gate for native and oauth connectors", () => {
    expect(
      crmResourceSyncEligible(
        {
          connectionMethod: "oauth",
          allowedReadCapabilities: ["contacts.read"],
          verifiedCapabilities: ["contacts.read"],
        },
        "contacts.read"
      )
    ).toBe(true);

    expect(
      crmResourceSyncEligible(
        {
          connectionMethod: "oauth",
          allowedReadCapabilities: ["contacts.read"],
          verifiedCapabilities: [],
        },
        "contacts.read"
      )
    ).toBe(false);
  });
});
