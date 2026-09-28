import { describe, expect, it, vi } from "vitest";
import {
  prepareOutcomeAwarePostCallSummary,
  preparePostCallReviewSummary,
} from "./liveCoach";

describe("outcome-aware post-call GenX policy", () => {
  it.each([
    ["no_answer", "No customer conversation"],
    ["voicemail", "voicemail"],
  ])("uses zero GenX calls for %s", async (outcome, phrase) => {
    const runAgent = vi.fn();
    const result = await prepareOutcomeAwarePostCallSummary({
      leadLabel: "John Smith",
      transcript: "",
      structured: { outcome },
      runAgent,
    });
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.genxCalls).toBe(0);
    expect(result.content).toContain(phrase);
  });

  it("uses salesperson notes as deliberate evidence in an answered-call summary", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      content: "Factual summary",
      usage: {},
      creditsCharged: 1,
    });
    await prepareOutcomeAwarePostCallSummary({
      leadLabel: "John Smith",
      transcript: "We discussed the course.",
      manualNotes: "Customer asked me to send the timetable.",
      structured: { outcome: "information_requested" },
      runAgent,
    });
    expect(runAgent.mock.calls[0][0].messages[0].content).toContain(
      "Salesperson-authored notes"
    );
    expect(runAgent.mock.calls[0][0].messages[0].content).toContain(
      "Customer asked me to send the timetable."
    );
  });

  it("prepares a read-only whole-call review after Stop", async () => {
    const result = await preparePostCallReviewSummary({
      leadLabel: "John Smith",
      transcript: "",
      manualNotes: "",
    });
    expect(result.content).toContain("No conversation content was captured");
  });

  it("uses at most one fast-tier GenX call for a complex answered call", async () => {
    const runAgent = vi
      .fn()
      .mockResolvedValue({
        content: "Factual summary",
        usage: {},
        creditsCharged: 1,
      });
    const result = await prepareOutcomeAwarePostCallSummary({
      leadLabel: "John Smith",
      transcript:
        "We discussed pricing and agreed to review the proposal Tuesday.",
      structured: {
        outcome: "interested",
        nextStep: "Review proposal Tuesday",
      },
      runAgent,
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0][0]).toMatchObject({ modelTier: "fast" });
    expect(result.genxCalls).toBe(1);
  });
});
