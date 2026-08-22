import { describe, expect, it } from "vitest";
import { detectLiveSignals } from "./signals";

describe("live conversation signals", () => {
  it("detects common sales objections and commitments without an LLM", () => {
    const signals = detectLiveSignals("That is too expensive for me. Call me back on Friday. I'll email the proposal this afternoon.");
    expect(signals.map(signal => signal.type)).toEqual(expect.arrayContaining(["price_objection", "customer_callback", "salesperson_commitment"]));
  });

  it("returns a bounded empty result for non-sales noise", () => {
    expect(detectLiveSignals("Hello and thank you for calling today.")).toEqual([]);
  });
});
