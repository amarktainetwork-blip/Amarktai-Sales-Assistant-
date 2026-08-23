import { describe, expect, it } from "vitest";
import { canSendReviewedReply, classifyInboundMessage } from "./inboundReview";
describe("inbound review-first communications", () => {
  it("prioritizes opt-out requests and preserves transparent reasons", () => expect(classifyInboundMessage({ body: "Please unsubscribe me from these emails." })).toEqual({ category: "unsubscribe", reasons: ["message includes an opt-out request"] }));
  it("does not permit a draft or rejected reply to be sent", () => { expect(canSendReviewedReply("draft")).toBe(false); expect(canSendReviewedReply("rejected")).toBe(false); expect(canSendReviewedReply("approved")).toBe(true); });
});
