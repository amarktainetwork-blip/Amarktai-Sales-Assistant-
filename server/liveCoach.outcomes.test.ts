import { describe, expect, it, vi } from "vitest";
import { prepareOutcomeAwarePostCallSummary } from "./liveCoach";

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
