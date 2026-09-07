import { describe, expect, it } from "vitest";
import { planAssistantSingleRecordAction } from "./assistantSingleRecord";

const context = {
  source: "manual_resolved" as const,
  connectedSystemId: 4,
  provider: "genie",
  contactExternalId: "lead-22",
  contactName: "Test Lead",
  opportunityExternalId: "opp-9",
  opportunityName: "Course enquiry",
  reasons: [],
};

describe("deterministic selected-record Assistant actions", () => {
  it("preserves an exact note without a model planner", () => {
    expect(
      planAssistantSingleRecordAction({
        instruction: "Add this exact note: Customer asked me to call Friday.",
        context,
      })
    ).toMatchObject({
      actionType: "append_contact_note",
      payload: {
        contactExternalId: "lead-22",
        content: "Customer asked me to call Friday.",
      },
    });
  });

  it("resolves an unambiguous tomorrow callback and selected opportunity stage", () => {
    const callback = planAssistantSingleRecordAction({
      instruction: "Create a callback for this customer at 10:00 tomorrow",
      context,
      now: new Date("2026-08-31T08:00:00.000Z"),
      timezone: "Africa/Johannesburg",
    });
    expect(callback).toMatchObject({
      actionType: "schedule_callback",
      payload: { contactExternalId: "lead-22" },
    });
    const dueAt = new Date(String(callback?.payload.dueAt));
    expect(dueAt.getDate()).toBe(1);
    expect(dueAt.toISOString()).toContain("T08:00:00.000Z");
    expect(
      planAssistantSingleRecordAction({
        instruction: "Move this deal to Qualified",
        context,
      })
    ).toMatchObject({
      actionType: "update_current_opportunity",
      payload: {
        opportunityExternalId: "opp-9",
        fields: { stage: "Qualified" },
      },
    });
  });
});
