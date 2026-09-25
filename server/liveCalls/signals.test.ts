[Reading 38 lines from start (total: 38 lines, 0 remaining)]

import { describe, expect, it } from "vitest";
import { detectLiveSignals } from "./signals";

describe("live conversation signals", () => {
  it("detects common sales objections and commitments without an LLM", () => {
    const signals = detectLiveSignals(
      "That is too expensive for me. Call me back on Friday. I'll email the proposal this afternoon."
    );
    expect(signals.map(signal => signal.type)).toEqual(
      expect.arrayContaining([
        "price_objection",
        "customer_callback",
        "commitment",
      ])
    );
  });

  it("returns a bounded empty result for non-sales noise", () => {
    expect(detectLiveSignals("Hello and thank you for calling today.")).toEqual(
      []
    );
  });
});

it("ignores greetings but detects product, funding and eligibility sales events", () => {
  expect(detectLiveSignals("Good morning")).toEqual([]);
  const signals = detectLiveSignals(
    "Can you tell me about the Cyber Security course and whether I can pay monthly? What are the entry requirements?"
  );
  expect(signals.map(signal => signal.type)).toEqual(
    expect.arrayContaining([
      "course_question",
      "funding_question",
      "eligibility_question",
      "question",
    ])
  );
});

[executed on device: amarktaisal (60c82bca-dc19-41e6-8ff8-d16e682f865e)]