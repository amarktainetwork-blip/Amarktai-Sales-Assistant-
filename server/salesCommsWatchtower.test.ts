import { describe, expect, it } from "vitest";
import {
  buildSalesWatchtowerFromEvidence,
  parsePromiseSignals,
} from "./salesCommsWatchtower";

const now = new Date("2026-08-28T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.valueOf() - days * 86_400_000);
const hoursAgo = (hours: number) => new Date(now.valueOf() - hours * 3_600_000);

describe("sales communications watchtower", () => {
  it("turns synchronized CRM evidence into explainable comms, leakage, health, hygiene, attention and manager signals", () => {
    const result = buildSalesWatchtowerFromEvidence({
      now,
      contacts: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 7,
        externalId: "contact-1",
        companyExternalId: null,
        ownerExternalId: "owner-1",
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.test",
        phone: null,
        normalizedEmail: "jane@example.test",
        normalizedPhone: null,
        lifecycleStage: "lead",
        sourceUpdatedAt: now,
        sourceRevision: "1",
        raw: {},
        createdAt: now,
        updatedAt: now,
      }],
      opportunities: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 7,
        externalId: "opp-1",
        companyExternalId: null,
        contactExternalId: "contact-1",
        ownerExternalId: "owner-1",
        name: "Career programme",
        pipeline: "sales",
        stage: "qualified",
        valueMinor: 179900,
        currency: "GBP",
        closeAt: daysAgo(1),
        lastActivityAt: daysAgo(10),
        nextStepAt: null,
        sourceUpdatedAt: now,
        sourceRevision: "1",
        raw: {},
        createdAt: now,
        updatedAt: now,
      }],
      tasks: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 7,
        externalId: "task-1",
        contactExternalId: "contact-1",
        opportunityExternalId: "opp-1",
        ownerExternalId: "owner-1",
        title: "Follow up",
        status: "open",
        dueAt: daysAgo(2),
        completedAt: null,
        sourceUpdatedAt: now,
        sourceRevision: "1",
        raw: {},
        createdAt: now,
        updatedAt: now,
      }],
      activities: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 7,
        externalId: "activity-1",
        contactExternalId: "contact-1",
        opportunityExternalId: "opp-1",
        ownerExternalId: "owner-1",
        activityType: "email_sent",
        occurredAt: daysAgo(3),
        body: "We sent the requested details.",
        sourceRevision: "1",
        raw: { direction: "outbound", channel: "email" },
        createdAt: now,
        updatedAt: now,
      }],
      inbound: [{
        id: 9,
        organisationId: 1,
        connectedSystemId: 7,
        externalMessageId: "msg-9",
        idempotencyKey: "msg-9",
        channel: "email",
        senderReference: "jane@example.test",
        contactExternalId: "contact-1",
        subject: "Question",
        body: "Can you confirm the next step?",
        classification: null,
        status: "classified",
        needsAction: true,
        receivedAt: hoursAgo(18),
        createdAt: hoursAgo(18),
      }],
      mappings: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 7,
        userId: 11,
        externalUserId: "owner-1",
        displayName: "Alex Sales",
        email: "alex@example.test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }],
      stageMappings: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 7,
        externalPipelineId: "sales",
        externalStageId: "qualified",
        pipelineLabel: "Sales",
        stageLabel: "Qualified",
        category: "qualified",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }],
    });

    expect(result.salesComms[0]).toMatchObject({
      customer: "Jane Smith",
      waitingOnUs: true,
      unresolvedInbound: 1,
      preferredChannel: "email",
    });
    expect(result.revenueLeakage.some(item => item.type === "opportunity_revenue_risk")).toBe(true);
    expect(result.revenueLeakage.some(item => item.type === "unanswered_customer")).toBe(true);
    expect(result.customerHealth[0]).toMatchObject({ status: "high_risk" });
    expect(result.pipelineHygiene[0].issues).toEqual(expect.arrayContaining([
      "Opportunity has no next step",
      "Close date is in the past",
    ]));
    expect(result.attention.length).toBeGreaterThan(0);
    expect(result.managerWatchtower.summary).toMatchObject({
      mappedSalespeople: 1,
      peopleNeedingAttention: 1,
      overdueTasks: 1,
      unansweredCustomers: 1,
      staleOpportunities: 1,
      noNextStep: 1,
      pipelineAtRiskMinor: 179900,
    });
    expect(result.managerWatchtower.people[0]).toMatchObject({
      name: "Alex Sales",
      ownerExternalId: "owner-1",
    });
  });

  it("does not treat closed opportunities as active leakage or hygiene exceptions", () => {
    const result = buildSalesWatchtowerFromEvidence({
      now,
      contacts: [],
      tasks: [],
      activities: [],
      inbound: [],
      mappings: [],
      opportunities: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 3,
        externalId: "won-1",
        companyExternalId: null,
        contactExternalId: null,
        ownerExternalId: null,
        name: "Won deal",
        pipeline: "main",
        stage: "stage-won",
        valueMinor: 500000,
        currency: "GBP",
        closeAt: daysAgo(20),
        lastActivityAt: daysAgo(20),
        nextStepAt: null,
        sourceUpdatedAt: now,
        sourceRevision: "1",
        raw: {},
        createdAt: now,
        updatedAt: now,
      }],
      stageMappings: [{
        id: 1,
        organisationId: 1,
        connectedSystemId: 3,
        externalPipelineId: "main",
        externalStageId: "stage-won",
        pipelineLabel: "Main",
        stageLabel: "Won",
        category: "won",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }],
    });
    expect(result.revenueLeakage).toHaveLength(0);
    expect(result.pipelineHygiene).toHaveLength(0);
    expect(result.customerHealth).toHaveLength(0);
  });

  it("accepts only model commitments tied to known evidence and calculates overdue state deterministically", () => {
    const content = JSON.stringify({
      promises: [
        {
          sourceId: "activity:1",
          actor: "team",
          commitment: "Send the enrolment document",
          dueAt: "2026-08-27T09:00:00.000Z",
          status: "open",
        },
        {
          sourceId: "invented:99",
          actor: "customer",
          commitment: "Pay tomorrow",
          dueAt: null,
          status: "open",
        },
      ],
    });
    expect(parsePromiseSignals(content, new Set(["activity:1"]), now)).toEqual([
      {
        sourceId: "activity:1",
        actor: "team",
        commitment: "Send the enrolment document",
        dueAt: "2026-08-27T09:00:00.000Z",
        status: "open",
        overdue: true,
      },
    ]);
  });
});
