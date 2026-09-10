import { describe, expect, it } from "vitest";
import {
  effectiveConfiguredBatchWorkflowKey,
  explicitCallbackTime,
  naturalCallbackTime,
  workflowRequestFromCommand,
} from "./governedAssistantEntry";

describe("canonical governed Assistant entry", () => {
  it("requires an explicit post-consultation outcome", () => {
    expect(
      workflowRequestFromCommand({
        command: "Prepare the post-consultation follow-up for this customer",
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Customer",
      })
    ).toMatchObject({
      error: expect.stringContaining("answered, no answer, or voicemail"),
    });
  });

  it("requires factual notes for answered calls and preserves them when supplied", () => {
    expect(
      workflowRequestFromCommand({
        command: "Post-consultation call answered for this customer",
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Customer",
      })
    ).toMatchObject({ error: expect.stringContaining("Notes:") });

    expect(
      workflowRequestFromCommand({
        command:
          "Post-consultation call answered. Notes: Customer confirmed the next appointment for Friday.",
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Customer",
      }).request
    ).toEqual({
      workflowKey: "post_consultation_follow_up",
      leadLabel: "Customer",
      callOutcome: "answered",
      conversationNotes: "Customer confirmed the next appointment for Friday.",
    });
  });

  it("parses no-answer and voicemail without inventing conversation notes", () => {
    expect(
      workflowRequestFromCommand({
        command: "Post-consultation call: no answer",
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Customer",
      }).request
    ).toEqual({
      workflowKey: "post_consultation_follow_up",
      leadLabel: "Customer",
      callOutcome: "no_answer",
      conversationNotes: undefined,
    });

    expect(
      workflowRequestFromCommand({
        command: "Post-consultation call went to voicemail",
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Customer",
      }).request?.callOutcome
    ).toBe("voicemail");
  });

  it("resolves ordinary callback language in the organisation timezone without guessing ambiguous times", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    expect(
      naturalCallbackTime({
        command: "Schedule her callback for Friday at 2pm",
        timeZone: "Europe/London",
        now,
      })
    ).toBe("2026-09-11T13:00:00.000Z");
    expect(
      naturalCallbackTime({
        command: "Schedule the callback tomorrow at 10am",
        timeZone: "Africa/Johannesburg",
        now,
      })
    ).toBe("2026-09-11T08:00:00.000Z");
    expect(
      naturalCallbackTime({
        command: "Schedule a callback Friday at 2",
        timeZone: "Europe/London",
        now,
      })
    ).toBeUndefined();
  });

  it("hands the final configured contact attempt into the final-close workflow", () => {
    const configuration = {
      workflows: {
        first_contact: {
          taskAliases: {
            attempt_1: "Initial Contact",
            attempt_2: "Second Contact",
            attempt_3: "Third Contact",
            attempt_4: "Final Contact",
          },
          taskSequence: ["attempt_1", "attempt_2", "attempt_3", "attempt_4"],
        },
        final_close: {},
      },
    } as never;
    expect(
      effectiveConfiguredBatchWorkflowKey({
        requestedWorkflowKey: "first_contact",
        taskTitle: "Final Contact",
        configuration,
      })
    ).toBe("final_close");
    expect(
      effectiveConfiguredBatchWorkflowKey({
        requestedWorkflowKey: "first_contact",
        taskTitle: "Second Contact",
        configuration,
      })
    ).toBe("first_contact");
  });

  it("accepts only timezone-qualified callback timestamps", () => {
    expect(
      explicitCallbackTime("Schedule a callback at 2026-09-03T10:00+02:00")
    ).toBe("2026-09-03T08:00:00.000Z");
    expect(explicitCallbackTime("Schedule a callback tomorrow at 10"))
      .toBeUndefined();
    expect(explicitCallbackTime("Schedule a callback at 2026-09-03T10:00"))
      .toBeUndefined();
  });
});
