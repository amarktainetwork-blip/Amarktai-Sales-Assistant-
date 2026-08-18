import { describe, expect, it } from "vitest";
import { assessHumanEmailDraft, createCommunicationDraftKey } from "./communicationQuality";

describe("Human Communications quality gate", () => {
  it("accepts a concise factual email with a clear subject", () => {
    const checks = assessHumanEmailDraft({ recipientEmail: "candidate@example.com", subject: "Your requested callback", body: "Hi Amara, thanks for confirming a suitable time. I can call you on Tuesday at 14:00 to answer the questions you raised.", facts: "Amara requested a Tuesday callback at 14:00." });
    expect(checks.every(check => check.passed)).toBe(true);
  });
  it("flags generic AI phrasing and a missing subject", () => {
    const checks = assessHumanEmailDraft({ recipientEmail: "candidate@example.com", subject: "", body: "I hope this finds you well! We are delighted to leverage a seamless opportunity for you.", facts: "Candidate requested more information." });
    expect(checks.find(check => check.key === "subject")?.passed).toBe(false);
    expect(checks.find(check => check.key === "human_tone")?.passed).toBe(false);
  });
  it("uses company context in the duplicate key so cross-company drafts are never reused", () => {
    const input = { recipientEmail: "candidate@example.com", purpose: "Callback reply", facts: "Requested a callback tomorrow.", companyContext: "Brand voice: warm and direct" };
    expect(createCommunicationDraftKey(input)).toBe(createCommunicationDraftKey(input));
    expect(createCommunicationDraftKey(input)).not.toBe(createCommunicationDraftKey({ ...input, companyContext: "Brand voice: formal" }));
  });
});
