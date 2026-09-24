[Reading 30 lines from start (total: 30 lines, 0 remaining)]

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
  it("keeps a direct negative customer answer visible for salesperson review", () => {
    expect(classifyInboundMessage({ body: "I don't have alternative" })).toEqual({
      category: "reply_needed",
      reasons: ["message contains a direct customer answer that needs review"],
    });
    expect(classifyInboundMessage({ body: "Not yet" })).toMatchObject({
      category: "reply_needed",
    });
  });
  it("does not permit a draft or rejected reply to be sent", () => { expect(canSendReviewedReply("draft")).toBe(false); expect(canSendReviewedReply("rejected")).toBe(false); expect(canSendReviewedReply("approved")).toBe(true); });
});

[executed on device: amarktaisal (60c82bca-dc19-41e6-8ff8-d16e682f865e)]