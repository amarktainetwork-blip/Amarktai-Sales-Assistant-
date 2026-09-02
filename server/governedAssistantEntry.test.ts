import { describe, expect, it } from "vitest";
import {
  explicitCallbackTime,
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
