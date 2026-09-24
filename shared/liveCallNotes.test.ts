import { describe, expect, it } from "vitest";
import {
  emptyLiveStructuredNotes,
  mergeLiveStructuredNotes,
  structuredNotesFromSignals,
} from "./liveCallNotes";

describe("live structured notes", () => {
  it("builds useful deterministic notes from signals and transcript", () => {
    const notes = structuredNotesFromSignals(
      [
        { type: "question", evidence: "Can I pay monthly?" },
        { type: "price_objection", evidence: "The price feels too high" },
        {
          type: "commitment",
          evidence: "I will send the funding guide",
        },
        { type: "customer_callback", evidence: "Call me back tomorrow at 2pm" },
        { type: "buying_signal", evidence: "How do I enrol?" },
      ],
      [
        "I want to move into cyber security.",
        "I have already completed a masters.",
        "Can I pay monthly?",
        "Call me back tomorrow at 2pm.",
      ].join(" ")
    );

    expect(notes.goals).toContain("I want to move into cyber security.");
    expect(notes.facts).toContain("I have already completed a masters.");
    expect(notes.questions).toEqual(["Can I pay monthly?"]);
    expect(notes.objections).toEqual(["The price feels too high"]);
    expect(notes.buyingSignals).toEqual(["How do I enrol?"]);
    expect(notes.commitments).toEqual(["I will send the funding guide"]);
    expect(notes.callbackRequests).toEqual(["Call me back tomorrow at 2pm"]);
    expect(notes.datesTimes).toContain("Call me back tomorrow at 2pm.");
    expect(notes.unresolvedItems).toEqual([
      "Can I pay monthly?",
      "The price feels too high",
    ]);
  });

  it("merges newest notes first without repeating a signal", () => {
    const current = {
      ...emptyLiveStructuredNotes(),
      questions: ["Can I pay monthly?"],
    };
    const merged = mergeLiveStructuredNotes(current, {
      ...emptyLiveStructuredNotes(),
      questions: ["What is included?", "Can I pay monthly?"],
      buyingSignals: ["How do I enrol?"],
    });

    expect(merged.questions).toEqual([
      "What is included?",
      "Can I pay monthly?",
    ]);
    expect(merged.buyingSignals).toEqual(["How do I enrol?"]);
  });
});
