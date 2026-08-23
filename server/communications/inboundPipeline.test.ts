import { describe, expect, it } from "vitest";
import {
  inboundIdempotencyKey,
  mayPrepareInboundReply,
  parseInboundWebhookEnvelope,
  shouldSurfaceInbound,
} from "./inboundPipeline";

describe("inbound message processing contract", () => {
  it("normalizes a connector message envelope", () => {
    expect(
      parseInboundWebhookEnvelope({
        message: {
          id: "m-1",
          channel: "email",
          from: "Lead@Example.com",
          subject: "Pricing",
          body: "Could you send pricing?",
          receivedAt: "2026-08-23T08:00:00Z",
        },
      })
    ).toMatchObject({
      externalMessageId: "m-1",
      channel: "email",
      senderReference: "Lead@Example.com",
      body: "Could you send pricing?",
    });
  });

  it("deduplicates within an organisation without crossing tenants", () => {
    expect(inboundIdempotencyKey(1, "email", "message-1")).toBe(
      inboundIdempotencyKey(1, "email", "message-1")
    );
    expect(inboundIdempotencyKey(1, "email", "message-1")).not.toBe(
      inboundIdempotencyKey(2, "email", "message-1")
    );
  });

  it("keeps actionable replies visible and review-controlled", () => {
    const classification = {
      category: "reply_needed" as const,
      reasons: ["question"],
    };
    expect(shouldSurfaceInbound(classification)).toBe(true);
    expect(mayPrepareInboundReply(classification, false)).toBe(true);
  });

  it("fails closed for unsubscribe and suppression", () => {
    const unsubscribe = {
      category: "unsubscribe" as const,
      reasons: ["opt out"],
    };
    expect(mayPrepareInboundReply(unsubscribe, false)).toBe(false);
    expect(
      mayPrepareInboundReply({ category: "reply_needed", reasons: [] }, true)
    ).toBe(false);
  });
});
