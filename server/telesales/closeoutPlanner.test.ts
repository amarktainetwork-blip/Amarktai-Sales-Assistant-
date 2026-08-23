import { describe, expect, it } from "vitest";
import { planTelesalesCloseout } from "./closeoutPlanner";

const base = {
  organisationId: 3,
  callSessionId: 41,
  leadLabel: "John Smith",
  summary: "No answer.",
  opportunityState: "unchanged" as const,
  commitmentsConfirmed: true,
};

describe("telesales closeout planner", () => {
  it("prepares deterministic no-answer administration", () => {
    const actions = planTelesalesCloseout({
      ...base,
      outcome: "no_answer",
      taskExternalId: "task-9",
      callbackAt: "2026-08-25T08:00:00.000Z",
    });
    expect(actions.map(action => action.actionType)).toEqual([
      "append_contact_note",
      "create_activity",
      "complete_active_task",
      "schedule_callback",
    ]);
  });

  it("creates a governed callback with stable idempotency", () => {
    const actions = planTelesalesCloseout({
      ...base,
      outcome: "callback",
      callbackAt: "2026-08-25T08:00:00.000Z",
      nextStep: "Discuss pricing",
    });
    expect(
      actions.find(action => action.actionType === "schedule_callback")
    ).toMatchObject({
      idempotencyKey: "live-call:3:41:callback",
      payload: {
        dueAt: "2026-08-25T08:00:00.000Z",
        taskTitle: "Discuss pricing",
      },
    });
  });

  it("proposes explicitly confirmed information follow-up", () => {
    const actions = planTelesalesCloseout({
      ...base,
      outcome: "information_requested",
      communication: {
        channel: "email",
        templateName: "Product brochure",
        to: "john@example.com",
        subject: "Product brochure",
        body: "Here is the product brochure.",
        approvalTemplateId: 12,
      },
    });
    expect(
      actions.some(action => action.actionType === "send_email_template")
    ).toBe(true);
  });

  it("does not silently create commitments when confirmation is absent", () => {
    const actions = planTelesalesCloseout({
      ...base,
      outcome: "other",
      commitmentsConfirmed: false,
      callbackAt: "2026-08-25T08:00:00.000Z",
      contactStatus: "Interested",
      communication: {
        channel: "sms",
        templateName: "Follow-up",
        to: "+27820000000",
        body: "Follow-up",
      },
    });
    expect(actions.map(action => action.actionType)).toEqual([
      "append_contact_note",
      "create_activity",
    ]);
  });

  it.each(["no_answer", "voicemail"] as const)(
    "closes %s with no transcript-derived commitment",
    outcome => {
      const actions = planTelesalesCloseout({
        ...base,
        outcome,
        summary:
          outcome === "no_answer"
            ? "Call attempt recorded. No customer conversation occurred."
            : "Call reached voicemail. No customer conversation was completed.",
        transcript: undefined,
        contactExternalId: "contact-1",
        taskExternalId: "task-1",
      } as Parameters<typeof planTelesalesCloseout>[0]);
      expect(actions.map(action => action.actionType)).toEqual([
        "append_contact_note",
        "create_activity",
        "complete_active_task",
      ]);
      expect(
        actions.every(
          action => action.payload.contactExternalId === "contact-1"
        )
      ).toBe(true);
    }
  );

  it("reuses inherited contact, task and opportunity identity across closeout actions", () => {
    const actions = planTelesalesCloseout({
      ...base,
      outcome: "callback",
      contactExternalId: "contact-1",
      taskExternalId: "task-1",
      opportunityExternalId: "opportunity-1",
      connectedSystemId: 12,
      provider: "custom_browser",
      callbackAt: "2026-08-25T08:00:00.000Z",
      opportunityState: "open",
    });
    expect(actions.map(action => action.actionType)).toEqual(
      expect.arrayContaining([
        "create_activity",
        "complete_active_task",
        "schedule_callback",
        "update_current_opportunity",
      ])
    );
    for (const action of actions) {
      expect(action.payload).toMatchObject({
        contactExternalId: "contact-1",
        taskExternalId: "task-1",
        opportunityExternalId: "opportunity-1",
        preferredConnectedSystemId: 12,
      });
    }
  });
});
