import { describe, expect, it } from "vitest";
import {
  activityFallsWithinWorkedTaskWindow,
  configuredTaskPriorityTitles,
  configuredNewLeadTaskTitles,
  paymentReviewCandidates,
  isCurrentActionableInbound,
  salespersonActivityProvesTaskHandled,
  sortTasksByConfiguredPriority,
} from "./today";

describe("current sales day relevance", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("surfaces current actionable replies and excludes old mailbox history", () => {
    expect(
      isCurrentActionableInbound(
        {
          needsAction: true,
          receivedAt: new Date("2026-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(true);
    expect(
      isCurrentActionableInbound(
        {
          needsAction: true,
          receivedAt: new Date("2025-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(false);
    expect(
      isCurrentActionableInbound(
        {
          needsAction: false,
          receivedAt: new Date("2026-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(false);
  });

  it("treats only verified salesperson activity as proof that an old task was worked", () => {
    const owner = "owner-1";
    const occurredAt = new Date("2026-09-07T10:00:00.000Z");
    expect(
      salespersonActivityProvesTaskHandled(
        {
          activityType: "call",
          ownerExternalId: owner,
          occurredAt,
          raw: {},
        },
        owner,
        "sales@example.com"
      )
    ).toBe(true);
    expect(
      salespersonActivityProvesTaskHandled(
        {
          activityType: "email",
          ownerExternalId: owner,
          occurredAt,
          raw: {
            direction: "outbound",
            senderReference: "Sales Person <sales@example.com>",
          },
        },
        owner,
        "sales@example.com"
      )
    ).toBe(true);
    expect(
      salespersonActivityProvesTaskHandled(
        {
          activityType: "email",
          ownerExternalId: owner,
          occurredAt,
          raw: {
            direction: "outbound",
            senderReference: "Campaign <marketing@example.com>",
          },
        },
        owner,
        "sales@example.com"
      )
    ).toBe(false);
    expect(
      salespersonActivityProvesTaskHandled(
        {
          activityType: "email",
          ownerExternalId: owner,
          occurredAt,
          raw: { direction: "inbound" },
        },
        owner,
        "sales@example.com"
      )
    ).toBe(false);
  });

  it("counts verified work performed shortly before a task is due", () => {
    const dueAt = new Date("2026-09-07T12:00:00.000Z");
    expect(
      activityFallsWithinWorkedTaskWindow(
        new Date("2026-09-07T11:59:31.000Z"),
        dueAt
      )
    ).toBe(true);
    expect(
      activityFallsWithinWorkedTaskWindow(
        new Date("2026-09-07T11:30:00.000Z"),
        dueAt
      )
    ).toBe(true);
    expect(
      activityFallsWithinWorkedTaskWindow(
        new Date("2026-09-07T11:29:59.999Z"),
        dueAt
      )
    ).toBe(false);
  });

  it("treats the configured first contact task as new-lead work", () => {
    const configuration = {
      workflows: {
        first_contact: {
          taskAliases: {
            attempt_one: "First Call",
            attempt_two: "Call 2",
          },
          taskSequence: ["attempt_one", "attempt_two"],
          sequence: [],
          eligibilityStatuses: [],
          stopStatuses: [],
          opportunityMappings: {},
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: [],
          requiredPostconditions: [],
        },
      },
      templates: {},
      approvedSenders: {},
      duplicateRules: [],
      closureMapping: {},
      requiredPostconditions: {},
      currentRecordRules: [],
    };
    expect(configuredNewLeadTaskTitles(configuration)).toEqual(["First Call"]);
  });

  it("prioritises configured contact-attempt task titles without client-specific constants", () => {
    const titles = configuredTaskPriorityTitles({
      workflows: {
        first_contact: {
          taskAliases: {
            attempt_one: "Initial Contact",
            attempt_two: "Second Contact",
          },
          taskSequence: ["attempt_one", "attempt_two"],
          sequence: [],
          eligibilityStatuses: [],
          stopStatuses: [],
          opportunityMappings: {},
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: [],
          requiredPostconditions: [],
        },
      },
      templates: {},
      approvedSenders: {},
      duplicateRules: [],
      closureMapping: {},
      requiredPostconditions: {},
      currentRecordRules: [],
    });
    expect(titles).toEqual(["Initial Contact", "Second Contact"]);
    const sorted = sortTasksByConfiguredPriority(
      [
        { title: "General Admin", dueAt: new Date("2026-09-01T08:00:00Z") },
        { title: "Second Contact", dueAt: new Date("2026-09-02T08:00:00Z") },
        { title: "Initial Contact", dueAt: new Date("2026-09-03T08:00:00Z") },
      ],
      titles
    );
    expect(sorted.map(item => item.title)).toEqual([
      "Initial Contact",
      "Second Contact",
      "General Admin",
    ]);
  });
});

describe("source-based payment checks", () => {
  const opportunities = [
    { id: 1, stage: "Awaiting settlement" },
    { id: 2, stage: "Paid" },
    { id: 3, stage: null },
  ];
  it("is disabled until the organisation configures the requirement", () => {
    expect(paymentReviewCandidates(opportunities, undefined)).toEqual([]);
  });
  it("selects configured pending stages without inferring payment or modifying CRM state", () => {
    const before = structuredClone(opportunities);
    expect(
      paymentReviewCandidates(opportunities, {
        enabled: true,
        pendingStages: ["awaiting settlement"],
      })
    ).toEqual([opportunities[0]]);
    expect(opportunities).toEqual(before);
    expect(
      paymentReviewCandidates(opportunities, {
        enabled: true,
        pendingStages: [],
      })
    ).toEqual([]);
  });
});
