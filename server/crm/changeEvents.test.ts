import { describe, expect, it } from "vitest";
import {
  deriveContactChangeEvents,
  deriveOpportunityChangeEvents,
  deriveTaskChangeEvents,
} from "./changeEvents";

describe("CRM change events", () => {
  it("suppresses historical contacts on the first baseline and emits new leads afterwards", () => {
    const current = {
      externalId: "c1",
      ownerExternalId: "owner",
      lifecycleStage: "lead",
      raw: {},
    };
    expect(
      deriveContactChangeEvents({ current, baselineComplete: false })
    ).toEqual([]);
    expect(
      deriveContactChangeEvents({ current, baselineComplete: true }).map(
        event => event.eventType
      )
    ).toEqual(["new_lead"]);
  });

  it("emits lifecycle and owner changes only when values actually change", () => {
    const current = {
      externalId: "c1",
      ownerExternalId: "owner-2",
      lifecycleStage: "customer",
      sourceUpdatedAt: new Date("2026-09-26T09:00:00Z"),
      raw: {},
    };
    const events = deriveContactChangeEvents({
      previous: {
        externalId: "c1",
        ownerExternalId: "owner-1",
        lifecycleStage: "lead",
        sourceUpdatedAt: new Date("2026-09-25T09:00:00Z"),
      },
      current,
    });
    expect(events.map(event => event.eventType)).toEqual([
      "customer_owner_changed",
      "customer_state_changed",
    ]);
  });

  it("suppresses historical opportunities on the baseline and emits new opportunities afterwards", () => {
    const current = {
      externalId: "o-new",
      contactExternalId: "c1",
      ownerExternalId: "owner",
      name: "New enquiry",
      stage: "Qualified",
      sourceUpdatedAt: new Date("2026-09-26T09:00:00Z"),
      raw: { status: "open" },
    };
    expect(
      deriveOpportunityChangeEvents({ current, baselineComplete: false })
    ).toEqual([]);
    expect(
      deriveOpportunityChangeEvents({ current, baselineComplete: true }).map(
        event => event.eventType
      )
    ).toEqual(["opportunity_created"]);
  });

  it("emits a Won sale when a genuinely new post-baseline opportunity first appears already won", () => {
    const current = {
      externalId: "o-won-new",
      contactExternalId: "c1",
      ownerExternalId: "owner",
      name: "Paid enrolment",
      stage: "Closed Won",
      closeAt: new Date("2026-09-26T09:00:00Z"),
      sourceUpdatedAt: new Date("2026-09-26T09:00:00Z"),
      raw: { status: "won" },
    };
    expect(
      deriveOpportunityChangeEvents({ current, baselineComplete: true }).map(
        event => event.eventType
      )
    ).toEqual(["opportunity_created", "sale_won"]);
  });

  it("emits Won once from authoritative status transition plus stage/next-step changes", () => {
    const events = deriveOpportunityChangeEvents({
      previous: {
        externalId: "o1",
        contactExternalId: "c1",
        ownerExternalId: "owner",
        stage: "Qualified",
        closeAt: null,
        nextStepAt: new Date("2026-09-27T10:00:00Z"),
        sourceUpdatedAt: new Date("2026-09-25T09:00:00Z"),
        raw: { status: "open" },
      },
      current: {
        externalId: "o1",
        contactExternalId: "c1",
        ownerExternalId: "owner",
        name: "Cyber Security",
        stage: "Closed Won",
        closeAt: new Date("2026-09-26T09:00:00Z"),
        nextStepAt: undefined,
        sourceUpdatedAt: new Date("2026-09-26T09:00:00Z"),
        raw: { status: "won" },
      },
    });
    expect(events.map(event => event.eventType)).toEqual([
      "sale_won",
      "opportunity_stage_changed",
      "opportunity_next_step_changed",
    ]);
  });

  it("does not infer a sale from a Won-looking stage when source status is not won", () => {
    const events = deriveOpportunityChangeEvents({
      previous: {
        externalId: "o1",
        contactExternalId: "c1",
        ownerExternalId: "owner",
        stage: "Qualified",
        closeAt: null,
        nextStepAt: null,
        sourceUpdatedAt: null,
        raw: { status: "open" },
      },
      current: {
        externalId: "o1",
        contactExternalId: "c1",
        ownerExternalId: "owner",
        name: "Course",
        stage: "Closed Won",
        sourceUpdatedAt: new Date("2026-09-26T09:00:00Z"),
        raw: { status: "open" },
      },
    });
    expect(events.some(event => event.eventType === "sale_won")).toBe(false);
  });

  it("emits task assignment, reschedule and CRM completion without guessing who completed it", () => {
    const events = deriveTaskChangeEvents({
      previous: {
        externalId: "t1",
        contactExternalId: "c1",
        opportunityExternalId: null,
        ownerExternalId: "owner-1",
        title: "Renewal call",
        status: "open",
        dueAt: new Date("2026-09-26T10:00:00Z"),
        sourceUpdatedAt: new Date("2026-09-25T10:00:00Z"),
      },
      current: {
        externalId: "t1",
        contactExternalId: "c1",
        ownerExternalId: "owner-2",
        title: "Renewal call",
        status: "closed",
        dueAt: new Date("2026-09-26T11:00:00Z"),
        sourceUpdatedAt: new Date("2026-09-26T09:00:00Z"),
        raw: {},
      },
    });
    expect(events.map(event => event.eventType)).toEqual([
      "task_assigned",
      "task_completed_in_crm",
      "task_rescheduled",
    ]);
  });
});
