import { describe, expect, it } from "vitest";
import {
  buildGroundedDraftInstruction,
  buildSafeGroundedFallback,
  groundedDraftIssues,
  type GroundedDraftContext,
} from "./assistantDraftGrounding";

const context: GroundedDraftContext = {
  request: "Reply to this customer. Don't send.",
  channel: "email",
  salespersonName: "Amelia De Beer",
  brandVoice: "Clear, professional, helpful, factual and concise.",
  personalStyle: "Warm and direct. Short paragraphs. Close with Thanks, Amelia.",
  salespersonVoiceExamples:
    "Example 1 (Email):\nHi Sarah, thanks for coming back to me. I can call you after 4 if that works. Thanks, Amelia",
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
    expect(prompt).toContain("RECENT SALESPERSON WRITING EXAMPLES");
    expect(prompt).toContain("Hi Sarah, thanks for coming back to me");
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

  it.each([
    "I've noted your questions and will come back to you.",
    "Thanks for your detailed email.",
    "I want to make sure I give you the exact information.",
    "I will come back to you clearly.",
    "I can send a point-by-point answer.",
    "If it helps, I can arrange a call.",
    "Happy to assist.",
  ])("rejects robotic sales wording: %s", draft => {
    expect(groundedDraftIssues(draft, context)).toContain(
      "robotic_sales_tone"
    );
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


describe("deterministic safe draft fallback", () => {
  it("still produces a useful reply when the customer asks protected commercial questions", () => {
    const riskyContext: GroundedDraftContext = {
      ...context,
      contactName: "Benson Makori",
      salespersonName: "Amelia De Beer",
      inboundMessage:
        "I am interested in the Cyber Security Career Programme. Please confirm whether the £3,900 fee includes exams, how the practical Cyber Range works, the finance repayment terms, whether my IT experience qualifies me, and what employment support is included.",
    };
    const fallback = buildSafeGroundedFallback(riskyContext);
    expect(fallback).toContain("Hi Benson");
    expect(fallback).toContain("Hi Benson");
    expect(fallback).toContain("Thanks for coming back to me");
    expect(fallback).toContain("course cost");
    expect(fallback).toContain("assessments or exams");
    expect(fallback).toContain("practical lab setup");
    expect(fallback).toContain("payment or finance arrangements");
    expect(fallback).toContain("employment-support process");
    expect(fallback).toContain("so I don’t give you the wrong detail");
    expect(fallback).toContain("Thanks,\nAmelia");
    expect(fallback).not.toContain("I've noted");
    expect(fallback).not.toContain("point-by-point");
    expect(groundedDraftIssues(fallback, riskyContext)).toEqual([]);
    expect(fallback).not.toContain("£3,900");
  });

  it("keeps non-email fallback concise and free of invented claims", () => {
    const fallback = buildSafeGroundedFallback({
      ...context,
      channel: "sms",
      contactName: "Benson Makori",
      inboundMessage: "What is the price and are finance options available?",
    });
    expect(fallback.split(/\s+/).length).toBeLessThanOrEqual(80);
    expect(groundedDraftIssues(fallback, { ...context, channel: "sms", contactName: "Benson Makori", inboundMessage: "What is the price and are finance options available?" })).toEqual([]);
  });
});
