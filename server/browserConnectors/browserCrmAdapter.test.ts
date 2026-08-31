import { describe, expect, it } from "vitest";
import {
  normalizeBrowserActivityRow,
  normalizeBrowserContactRow,
  normalizeBrowserOpportunityRow,
  normalizeBrowserTaskRow,
  resolveBrowserProfile,
} from "./browserCrmAdapter";

describe("provider-neutral browser CRM row normalization", () => {
  it("normalizes contacts and retains external identity", () => {
    expect(
      normalizeBrowserContactRow({
        id: "c-1",
        email: "Lead@Example.com",
        phone: "+27 82 000 0000",
        status: "Prospect",
      })
    ).toMatchObject({
      externalId: "c-1",
      email: "lead@example.com",
      lifecycleStage: "Prospect",
    });
  });

  it("normalizes tasks, opportunities and activities", () => {
    expect(
      normalizeBrowserTaskRow({
        externalId: "t-1",
        title: "Callback",
        status: "open",
        dueAt: "2026-08-24T08:00:00Z",
      }).dueAt?.toISOString()
    ).toBe("2026-08-24T08:00:00.000Z");
    expect(
      normalizeBrowserOpportunityRow({
        id: "o-1",
        name: "Renewal",
        value: "125.50",
        stage: "Proposal",
      })
    ).toMatchObject({
      externalId: "o-1",
      valueMinor: 12550,
      stage: "Proposal",
    });
    expect(
      normalizeBrowserActivityRow({
        id: "a-1",
        type: "email",
        occurredAt: "2026-08-23T08:00:00Z",
      })
    ).toMatchObject({ externalId: "a-1", activityType: "email" });
  });

  it("fails closed without an external record identity", () => {
    expect(() =>
      normalizeBrowserContactRow({ email: "missing@example.com" })
    ).toThrow("INVALID_EXTERNAL_ID");
    expect(() => normalizeBrowserTaskRow({ title: "No ID" })).toThrow(
      "INVALID_EXTERNAL_ID"
    );
  });
});

describe("browser profile", () => {
  it("uses connectedSystem.baseUrl as a provider hint without credentials", async () => {
    const profile = await resolveBrowserProfile(
      {
        id: 8,
        organisationId: 7,
        provider: "genie",
        displayName: "Genie",
        baseUrl: "https://genie.customer.example/",
        connectionMethod: "browser",
        allowedReadCapabilities: [],
        allowedWriteCapabilities: [],
        verifiedCapabilities: [],
        scopes: [],
        configuration: {},
      },
      "genie"
    );
    expect(profile?.login).toEqual({ url: "https://genie.customer.example/" });
    expect(JSON.stringify(profile)).not.toMatch(/credential|passcode|secret/i);
  });
});
