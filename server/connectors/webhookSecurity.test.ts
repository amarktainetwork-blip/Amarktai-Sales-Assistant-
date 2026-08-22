import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature, webhookReceiptDisposition } from "./webhookSecurity";

describe("webhook signature boundary", () => {
  it("accepts only a timing-safe verified HMAC configuration", () => {
    const payload = '{"event":"updated"}'; const secret = "test-secret";
    const signature = createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyWebhookSignature({ payload, secret, signature: `sha256=${signature}`, algorithm: "sha256" })).toBe("verified");
    expect(webhookReceiptDisposition("verified")).toBe("received");
  });

  it("fails closed for absent configuration, signatures, and invalid bytes", () => {
    expect(verifyWebhookSignature({ payload: "x", signature: "00", secret: null, algorithm: null })).toBe("not_configured");
    expect(verifyWebhookSignature({ payload: "x", secret: "secret", algorithm: "sha256" })).toBe("missing");
    expect(verifyWebhookSignature({ payload: "x", signature: "00", secret: "secret", algorithm: "sha256" })).toBe("invalid");
    expect(webhookReceiptDisposition("invalid")).toBe("ignored");
  });
});
