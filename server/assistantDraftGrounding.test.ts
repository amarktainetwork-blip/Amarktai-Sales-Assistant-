import { describe, expect, it } from "vitest";
import {
  buildGroundedDraftInstruction,
  groundedDraftIssues,
  type GroundedDraftContext,
} from "./assistantDraftGrounding";

const context: GroundedDraftContext = {
  request: "Reply to this customer. Don't send.",
  channel: "email",
  salespersonName: "Amelia De Beer",
  brandVoice: "Clear, professional, helpful, factual and concise.",
  personalStyle: "Warm and direct. Short paragraphs. Close with Thanks, Amelia.",
  contactName: "Namrata Parikh",
  inboundMessage:
    "I am looking for cyber security training and funding options.",
  courseInterest: "Cyber Security",
  customerContext:
    "Training Start Timeframe: As soon as possible\nDo you have any IT Experience?: Yes — I have experience",
};

describe("grounded customer-facing draft contract", () => {
  it("grounds the draft in salesperson voice and known customer context", () => {
    const prompt = buildGroundedDraftInstruction(context);
    expect(prompt).toContain("SALESPERSON: Amelia De Beer");
    expect(prompt).toContain("PERSONAL STYLE PREFERENCES");
    expect(prompt).toContain("Short paragraphs");
    expect(prompt).toContain("Course/programme interest: Cyber Security");
    expect(prompt).toContain("Training Start Timeframe: As soon as possible");
    expect(prompt).toContain("never as an AI, CRM, compliance system");
    expect(prompt).toContain("do not expose internal limitations");
  });

  it("rejects internal knowledge-limit language from customer-facing copy", () => {
    expect(
      groundedDraftIssues(
        "Funding information is not available in the approved information, but I can confirm it.",
        context
      )
    ).toContain("leaks_internal_limitation_language");
  });

  it("does not ask the customer to repeat a known course interest", () => {
    expect(
      groundedDraftIssues(
        "Hi Namrata, which course are you interested in?",
        context
      )
    ).toContain("asks_for_known_thread_topic");
  });

  it("still rejects unsupported protected commercial claims", () => {
    expect(
      groundedDraftIssues(
        "The programme is guaranteed and finance is available at £99.",
        context
      )
    ).toEqual(
      expect.arrayContaining([
        "unsupported_commercial_claim:guaranteed",
        "unsupported_commercial_claim:finance is available",
        "unsupported_commercial_claim:£99",
      ])
    );
  });

  it("allows a natural next step without inventing an unsupported funding promise", () => {
    expect(
      groundedDraftIssues(
        "Hi Namrata, thanks for getting in touch about Cyber Security. I can see you want to get started quickly. I’ll check which funding or payment options apply to you and confirm the exact options.\n\nAmelia",
        context
      )
    ).toEqual([]);
  });
});

describe("context and channel safeguards", () => {
  it.each([
    "approved knowledge",
    "knowledge base",
    "CRM says",
    "the system cannot",
    "as an AI",
    "internal information unavailable",
  ])("rejects %s", text => {
    expect(groundedDraftIssues(text, context)).toContain(
      "leaks_internal_limitation_language"
    );
  });
  it("does not ask again for known timing", () => {
    expect(
      groundedDraftIssues("When would you like to start?", context)
    ).toContain("asks_for_known_timing");
  });
  it("uses known experience without asking again", () => {
    expect(buildGroundedDraftInstruction(context)).toContain(
      "Yes — I have experience"
    );
    expect(
      groundedDraftIssues("Do you have IT experience?", context)
    ).toContain("asks_for_known_experience");
    expect(
      groundedDraftIssues(
        "Your IT experience will help us discuss your training needs.",
        context
      )
    ).toEqual([]);
  });
  it.each(["sms", "whatsapp"] as const)(
    "keeps %s shorter than email",
    channel => {
      const body = "Thanks ".repeat(90);
      expect(groundedDraftIssues(body, { ...context, channel })).toContain(
        "message_too_long_for_channel"
      );
      expect(groundedDraftIssues(body, context)).toEqual([]);
    }
  );
  it("does not treat a customer's price question as verified pricing", () => {
    expect(
      groundedDraftIssues("The price is £99.", {
        ...context,
        inboundMessage: "Is the price £99?",
      })
    ).toContain("unsupported_commercial_claim:£99");
  });
  it.each([
    "You are eligible for funding",
    "Funding is available",
    "The course is accredited",
  ])("blocks unverified claim: %s", draft => {
    expect(
      groundedDraftIssues(draft, context).some(issue =>
        issue.startsWith("unsupported_commercial_claim:")
      )
    ).toBe(true);
  });
});

it("does not validate a different decimal price by prefix", () => {
  expect(
    groundedDraftIssues("The price is £99.50.", {
      ...context,
      approvedKnowledge: "The price is £99.99.",
    })
  ).toContain("unsupported_commercial_claim:£99.50");
});
