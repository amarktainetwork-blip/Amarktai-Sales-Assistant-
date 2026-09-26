import { describe, expect, it } from "vitest";
import {
  addTwelveCalendarMonths,
  deriveCommercialTruth,
  parseCommercialDate,
} from "./commercialTruth";

const won = {
  connectedSystemId: 8,
  externalId: "won-1",
  pipeline: "Career Programmes",
  stage: "Enrolled & Paid (Closed Won)",
  closeAt: new Date("2025-09-30T10:54:34.000Z"),
  sourceUpdatedAt: new Date("2025-09-30T10:54:34.000Z"),
  raw: { status: "won", stageExternalId: "won-stage" },
};

const wonMapping = {
  connectedSystemId: 8,
  externalStageId: "won-stage",
  stageLabel: "Enrolled & Paid (Closed Won)",
  category: "won",
  isActive: true,
};

describe("commercial truth", () => {
  it("parses the configured UK enrolment date format", () => {
    expect(parseCommercialDate("30/09/2025")?.toISOString()).toBe(
      "2025-09-30T00:00:00.000Z"
    );
    expect(
      addTwelveCalendarMonths(new Date("2025-09-30T00:00:00.000Z")).toISOString()
    ).toBe("2026-09-30T00:00:00.000Z");
  });

  it("uses one mapped won opportunity as authoritative purchase evidence", () => {
    const truth = deriveCommercialTruth({
      mappedFields: [],
      opportunities: [won],
      stageMappings: [wonMapping],
    });
    expect(truth.payment).toMatchObject({
      state: "paid",
      latestPaidOpportunityExternalId: "won-1",
      historicalPaidCount: 1,
    });
    expect(truth.renewal).toMatchObject({
      state: "proven",
      basis: "single_mapped_won_opportunity",
      sourceOpportunityExternalId: "won-1",
    });
    expect(truth.renewal.nextAccessExpiryAt?.toISOString()).toBe(
      "2026-09-30T10:54:34.000Z"
    );
  });

  it("does not treat an open pending-payment opportunity as paid", () => {
    const truth = deriveCommercialTruth({
      mappedFields: [],
      opportunities: [
        {
          ...won,
          externalId: "historic-won",
          sourceUpdatedAt: new Date("2025-09-30T10:54:34.000Z"),
        },
        {
          connectedSystemId: 8,
          externalId: "pending",
          stage: "Enrolment – Verbal Yes / Pending Payment",
          closeAt: null,
          sourceUpdatedAt: new Date("2026-09-15T13:13:35.000Z"),
          raw: { status: "open", stageExternalId: "pending-stage" },
        },
      ],
      stageMappings: [wonMapping],
    });
    expect(truth.payment).toMatchObject({
      state: "not_proven",
      latestOpportunityExternalId: "pending",
      latestPaidOpportunityExternalId: "historic-won",
      historicalPaidCount: 1,
      evidence: "no_current_payment_proof",
    });
    expect(truth.renewal.state).toBe("proven");
  });

  it("fails closed when multiple paid events exist without an enrolment date", () => {
    const truth = deriveCommercialTruth({
      mappedFields: [],
      opportunities: [
        won,
        {
          ...won,
          externalId: "won-2",
          closeAt: new Date("2026-09-23T08:13:31.000Z"),
          sourceUpdatedAt: new Date("2026-09-23T08:13:31.000Z"),
        },
      ],
      stageMappings: [wonMapping],
    });
    expect(truth.renewal).toMatchObject({
      state: "ambiguous",
      basis: "multiple_mapped_won_opportunities",
      enrolmentOrPurchaseAt: null,
      nextAccessExpiryAt: null,
      evidenceCount: 2,
    });
  });

  it("prefers the explicitly mapped Course Enrolment Date", () => {
    const truth = deriveCommercialTruth({
      mappedFields: [
        {
          label: "Course Enrolment Date",
          purpose: "enrolment",
          value: "30/09/2025",
        },
      ],
      opportunities: [
        won,
        {
          ...won,
          externalId: "won-2",
          closeAt: new Date("2026-09-23T08:13:31.000Z"),
          sourceUpdatedAt: new Date("2026-09-23T08:13:31.000Z"),
        },
      ],
      stageMappings: [wonMapping],
    });
    expect(truth.renewal).toMatchObject({
      state: "proven",
      basis: "configured_enrolment_field",
      sourceFieldLabel: "Course Enrolment Date",
      evidenceCount: 1,
    });
  });
});
