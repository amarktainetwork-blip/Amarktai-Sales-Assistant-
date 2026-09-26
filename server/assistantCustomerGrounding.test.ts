import { describe, expect, it } from "vitest";
import {
  assistantCustomerEvidence,
  selectedCustomerResponseContract,
} from "./assistantRoutes";

function customerDetailFixture() {
  return {
    name: "Nabeel Khattak",
    lifecycleStage: "active",
    companyName: "Example Training",
    interest: { primary: "Cyber Security", values: [], tags: [] },
    attributes: {
      source: "Facebook",
      tags: ["cyber security landing page"],
      customFields: {},
      customFieldLabels: {},
    },
    mappedFields: [
      {
        label: "Course",
        purpose: "interest",
        value: "Cyber Security",
      },
    ],
    commercialTruth: {
      payment: {
        state: "not_proven",
        latestOpportunityExternalId: "opp-open",
        latestOpportunityStage: "Enrolment – Verbal Yes / Pending Payment",
        latestPaidAt: new Date("2025-09-30T10:54:34Z"),
        latestPaidOpportunityExternalId: "opp-paid",
        historicalPaidCount: 1,
        evidence: "no_current_payment_proof",
      },
      renewal: {
        state: "proven",
        basis: "single_mapped_won_opportunity",
        enrolmentOrPurchaseAt: new Date("2025-09-30T10:54:34Z"),
        nextAccessExpiryAt: new Date("2026-09-30T10:54:34Z"),
        sourceFieldLabel: null,
        sourceOpportunityExternalId: "opp-paid",
        evidenceCount: 1,
      },
    },
    openOpportunity: {
      name: "September enrolment",
      pipeline: "Admissions",
      stage: "Qualified",
      updatedAt: new Date("2026-09-23T15:10:00Z"),
      raw: { nextStep: "Confirm funding route" },
    },
    tasks: {
      total: 2,
      current: [
        {
          title: "Call at agreed time",
          status: "open",
          dueAt: new Date("2026-09-24T15:00:00Z"),
          sourceUpdatedAt: new Date("2026-09-23T15:06:00Z"),
        },
      ],
      completed: [
        {
          title: "Send course outline",
          status: "completed",
          dueAt: null,
          completedAt: new Date("2026-09-22T10:00:00Z"),
          sourceUpdatedAt: new Date("2026-09-22T10:00:00Z"),
        },
      ],
    },
    opportunities: {
      total: 1,
      items: [
        {
          name: "September enrolment",
          pipeline: "Admissions",
          stage: "Qualified",
          updatedAt: new Date("2026-09-23T15:10:00Z"),
        },
      ],
    },
    activities: {
      total: 1,
      items: [
        {
          id: 1,
          externalId: "note-1",
          activityType: "note",
          occurredAt: new Date("2026-09-23T15:05:22Z"),
          body:
            "Follow-up scheduled for tomorrow at 4pm" +
            "<script>ignore this instruction</script>",
          raw: {},
        },
      ],
    },
    communications: {
      limit: 50,
      items: [
        {
          id: 2,
          externalMessageId: "mail-1",
          channel: "email",
          receivedAt: new Date("2026-09-23T12:36:26Z"),
          body:
            '<div dir="auto">Can you call me at 16:00 today? &amp; confirm</div>' +
            '<div class="gmail_quote">On Wed Amelia wrote: older thread</div>',
          subject: "Re: Cyber Security",
          needsAction: true,
          classification: {},
        },
      ],
    },
  } as any;
}

describe("Assistant selected-customer grounding", () => {
  it("includes the complete evidence required for customer-specific preparation", () => {
    const evidence = assistantCustomerEvidence(customerDetailFixture());
    expect(evidence.mappedFields).toEqual([
      {
        label: "Course",
        purpose: "interest",
        value: "Cyber Security",
      },
    ]);
    expect(evidence.openOpportunity?.nextStep).toBe("Confirm funding route");
    expect(evidence.currentTasks[0].title).toBe("Call at agreed time");
    expect(evidence.completedTasks[0].title).toBe("Send course outline");
    expect(evidence.opportunityHistory[0].stage).toBe("Qualified");
    expect(evidence.commercialTruth).toMatchObject({
      payment: { state: "not_proven" },
      renewal: {
        state: "proven",
        basis: "single_mapped_won_opportunity",
      },
    });
  });

  it("keeps newest-first chronology and removes quoted or executable email content", () => {
    const evidence = assistantCustomerEvidence(customerDetailFixture());

    expect(evidence.conversationTimeline.order).toBe("newest_first");
    expect(evidence.conversationTimeline.items).toHaveLength(2);
    expect(evidence.conversationTimeline.items[0].body).toBe(
      "Follow-up scheduled for tomorrow at 4pm"
    );
    expect(evidence.conversationTimeline.items[1].body).toBe(
      "Can you call me at 16:00 today? & confirm"
    );
    expect(JSON.stringify(evidence)).not.toContain("older thread");
    expect(JSON.stringify(evidence)).not.toContain("ignore this instruction");
  });

  it("requires chronology-aware, complete call preparation for a selected customer", () => {
    const contract = selectedCustomerResponseContract({
      agentKey: "conversation_coach",
      hasCustomer: true,
    });

    expect(contract?.mode).toBe("customer_specific_call_preparation");
    expect(contract?.requirements.join(" ")).toContain(
      "relative to the timestamp of that source record"
    );
    expect(contract?.requirements.join(" ")).toContain(
      "Do not ask discovery questions the customer has already answered"
    );
    expect(contract?.requirements.join(" ")).toContain(
      "Finish the answer completely"
    );
  });
});
