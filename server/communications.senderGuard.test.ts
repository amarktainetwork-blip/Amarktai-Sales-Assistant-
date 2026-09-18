import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientActionConfiguration: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./clientActionConfiguration", () => ({
  getClientActionConfiguration: mocks.getClientActionConfiguration,
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { sendSalesMessage } from "./communications";

describe("outbound sender execution guard", () => {
  beforeEach(() => {
    mocks.getClientActionConfiguration.mockReset();
    mocks.getDb.mockReset();
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
  });

  it("routes selected CRM email through the adapter without requiring a Microsoft sender identity", async () => {
    const sendEmail = vi.fn(async input => ({
      operation: "send_email",
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: {},
    }));
    await sendSalesMessage({
      adapter: { sendEmail } as never,
      connection: {
        id: 8,
        organisationId: 2,
        provider: "genie",
      } as never,
      secret: { browserSession: {} },
      message: {
        channel: "email",
        to: "lead@example.test",
        subject: "Follow-up",
        body: "Approved exact message",
        contactExternalId: "contact-1",
      },
      correlationId: "email-route-test",
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: "lead@example.test",
      subject: "Follow-up",
      body: "Approved exact message",
    });
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
