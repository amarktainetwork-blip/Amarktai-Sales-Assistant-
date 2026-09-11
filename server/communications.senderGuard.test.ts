import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientActionConfiguration: vi.fn(),
}));

vi.mock("./clientActionConfiguration", () => ({
  getClientActionConfiguration: mocks.getClientActionConfiguration,
}));

import { sendSalesMessage } from "./communications";

describe("outbound sender execution guard", () => {
  beforeEach(() => {
    mocks.getClientActionConfiguration.mockReset();
  });

  it("rejects a reviewed SMS sender that is no longer approved for the organisation", async () => {
    mocks.getClientActionConfiguration.mockResolvedValue({
      templates: {},
      approvedSenders: {
        sms: ["+447428000560"],
        whatsapp: [],
      },
    });
    const sendSms = vi.fn();
    await expect(
      sendSalesMessage({
        adapter: { sendSms } as never,
        connection: {
          id: 1,
          organisationId: 2,
          provider: "genie",
        } as never,
        secret: { browserSession: {} },
        message: {
          channel: "sms",
          to: "+447700900123",
          body: "Approved exact message",
          senderIdentity: "+441111111111",
        },
        correlationId: "sender-test",
      })
    ).rejects.toThrow("SENDER_NOT_APPROVED");
    expect(sendSms).not.toHaveBeenCalled();
  });
});
