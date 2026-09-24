import { describe, expect, it } from "vitest";
import { canSendReviewedReply, classifyInboundMessage } from "./inboundReview";
describe("inbound review-first communications", () => {
  it("prioritizes opt-out requests and preserves transparent reasons", () => expect(classifyInboundMessage({ body: "Please unsubscribe me from these emails." })).toEqual({ category: "unsubscribe", reasons: ["message includes an opt-out request"] }));
  it("flags enrolment and payment intent before ordinary reply-needed mail", () => {
    expect(classifyInboundMessage({ body: "I look forward to moving forward with the course. I need the OTP before I can pay the deposit." })).toEqual({
      category: "sale_intent",
      reasons: ["message includes enrolment, payment, or proceed language"],
    });
  });
  it("does not promote quoted invoice history into a false possible-sale alert", () => {
    expect(classifyInboundMessage({
      subject: "Re: Payment due today",
      body: '<div>Can we reschedule it to another day? Abit busy rn</div><blockquote><p>Please pay your invoice and deposit today.</p></blockquote>',
    })).toEqual({
      category: "reply_needed",
      reasons: ["message includes a question or request"],
    });
  });
  it("keeps substantive customer answers visible even without a question mark", () => {
    expect(classifyInboundMessage({ body: "I don't have alternative" })).toEqual({
      category: "reply_needed",
      reasons: ["substantive customer reply needs salesperson review"],
    });
    expect(
      classifyInboundMessage({
        body: "I need to wait, I would like to do it myself. Thank you",
      })
    ).toEqual({
      category: "reply_needed",
      reasons: ["substantive customer reply needs salesperson review"],
    });
    expect(classifyInboundMessage({ body: "Not yet" })).toMatchObject({
      category: "reply_needed",
    });
    expect(classifyInboundMessage({ body: "Yes" })).toMatchObject({
      category: "reply_needed",
    });
  });

  it("keeps acknowledgements and automated notices out of the action queue", () => {
    expect(classifyInboundMessage({ body: "Okay thanks" })).toEqual({
      category: "information",
      reasons: ["message is a simple acknowledgement or automated notice"],
    });
    expect(
      classifyInboundMessage({
        subject: "Automatic Reply",
        body: "I am out of office until Monday.",
      })
    ).toMatchObject({ category: "information" });
  });
  it("does not permit a draft or rejected reply to be sent", () => { expect(canSendReviewedReply("draft")).toBe(false); expect(canSendReviewedReply("rejected")).toBe(false); expect(canSendReviewedReply("approved")).toBe(true); });
});
