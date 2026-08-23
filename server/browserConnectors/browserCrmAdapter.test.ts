import { describe, expect, it } from "vitest";
import {
  normalizeBrowserActivityRow,
  normalizeBrowserContactRow,
  normalizeBrowserOpportunityRow,
  normalizeBrowserTaskRow,
} from "./browserCrmAdapter";

describe("Genie deterministic row normalization", () => {
  it("normalizes contacts and retains the provider external ID", () => {
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

  it("normalizes tasks and Manual Actions into the existing task model", () => {
    const result = normalizeBrowserTaskRow({
      externalId: "ma-1",
      title: "Pricing callback",
      status: "open",
      type: "manual_action",
      dueAt: "2026-08-24T08:00:00Z",
    });
    expect(result).toMatchObject({
      externalId: "ma-1",
      title: "Pricing callback",
      raw: { sourceKind: "manual_action" },
    });
    expect(result.dueAt?.toISOString()).toBe("2026-08-24T08:00:00.000Z");
  });

  it("normalizes opportunities and activity history", () => {
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
        body: "Requested pricing",
      })
    ).toMatchObject({
      externalId: "a-1",
      activityType: "email",
      body: "Requested pricing",
    });
  });

  it("fails safely when a structured row has no external ID", () => {
    expect(() =>
      normalizeBrowserContactRow({ email: "missing@example.com" })
    ).toThrow("INVALID_EXTERNAL_ID");
    expect(() => normalizeBrowserTaskRow({ title: "No ID" })).toThrow(
      "INVALID_EXTERNAL_ID"
    );
  });
});
