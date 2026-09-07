import { describe, expect, it } from "vitest";
import {
  buildGroundedDraftInstruction,
  groundedDraftIssues,
} from "./assistantDraftGrounding";

const cyberContext = {
  request: "Draft a reply",
  contactName: "Graeme",
  emailSubject: "Re: cyber security job programme",
  inboundMessage: "Please send me the current price.",
  approvedKnowledge: "Cyber Security Job Programme is an approved programme.",
};

describe("assistant draft grounding", () => {
  it("rejects asking for a programme already explicit in the thread", () => {
    expect(
      groundedDraftIssues(
        "Please let me know which Cyber Security Career Programme or course you are interested in.",
        cyberContext
      )
    ).toContain("asks_for_known_thread_topic");
    expect(
      groundedDraftIssues(
        "Thanks for getting in touch about the Cyber Security Job Programme. I do not have an approved current price available, so I will confirm it before we send anything across.",
        cyberContext
      )
    ).toEqual([]);
  });

  it("rejects unsupported protected commercial claims", () => {
    expect(
      groundedDraftIssues(
        "The programme is guaranteed and finance is available at £99.",
        cyberContext
      )
    ).toEqual(
      expect.arrayContaining([
        "unsupported_commercial_claim:guaranteed",
        "unsupported_commercial_claim:finance is available",
        "unsupported_commercial_claim:£99",
      ])
    );
    expect(buildGroundedDraftInstruction(cyberContext)).toContain(
      "Never ask for information already explicit"
    );
  });
});
