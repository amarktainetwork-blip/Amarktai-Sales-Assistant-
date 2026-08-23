import { describe, expect, it } from "vitest";
import { validateSalesMessage } from "./communications";

describe("outbound blank-content guard", () => {
  it.each([
    {
      channel: "email" as const,
      to: "lead@example.test",
      subject: "Follow-up",
    },
    { channel: "sms" as const, to: "+27820000000" },
    { channel: "whatsapp" as const, to: "+27820000000" },
  ])("blocks blank $channel before any native or fallback sender", message => {
    expect(() => validateSalesMessage({ ...message, body: "   " })).toThrow(
      "TEMPLATE_CONTENT_REQUIRED"
    );
  });

  it("retains a valid custom message for the normal governed review flow", () => {
    expect(
      validateSalesMessage({
        channel: "email",
        to: "lead@example.test",
        subject: " Follow-up ",
        body: " Hello John ",
      })
    ).toMatchObject({ subject: "Follow-up", body: "Hello John" });
  });
});
