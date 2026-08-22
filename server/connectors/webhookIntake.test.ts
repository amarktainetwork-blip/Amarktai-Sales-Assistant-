import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessWebhookIntake } from "./webhookIntake";

describe("webhook intake policy", () => {
  const base = { status: "ready", verifiedCapabilities: ["webhook_inbound"], webhookSecret: "secret", webhookAlgorithm: "sha256" as const };

  it("requires a ready connector, verified capability, and valid signature", () => {
    const payload = "payload"; const signature = createHmac("sha256", "secret").update(payload).digest("hex");
    expect(assessWebhookIntake(base, payload, signature)).toEqual({ signatureStatus: "verified", processingStatus: "received" });
    expect(assessWebhookIntake({ ...base, status: "testing" }, payload, signature)).toMatchObject({ processingStatus: "ignored", reason: "CONNECTOR_NOT_READY" });
    expect(assessWebhookIntake({ ...base, verifiedCapabilities: [] }, payload, signature)).toMatchObject({ processingStatus: "ignored", reason: "WEBHOOK_CAPABILITY_UNVERIFIED" });
  });
});
